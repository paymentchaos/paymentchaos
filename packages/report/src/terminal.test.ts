import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunReport } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { normalizeTerminalOutput } from "./normalize.ts";
import { renderTerminalReport, truncateAssertionName } from "./terminal.ts";

const failureReport: RunReport = {
  schemaVersion: 1,
  runId: "run_demo",
  seed: 1337,
  planHash: "7f3a9c2b",
  provider: "stripe",
  scenario: "renewal survives duplicates and reordering",
  startedAt: "2026-01-15T12:00:00.000Z",
  finishedAt: "2026-01-15T12:00:01.234Z",
  repeat: 20,
  repeatsFailed: 1,
  status: "failed",
  deliveries: [
    {
      seq: 1,
      attempt: 1,
      eventType: "invoice.paid",
      eventId: "evt_demo_1",
      statusCode: 200,
      latencyMs: 45.2,
      chaosTags: ["duplicate"],
    },
    {
      seq: 2,
      attempt: 2,
      eventType: "invoice.paid",
      eventId: "evt_demo_2",
      statusCode: 200,
      latencyMs: 38,
      chaosTags: ["duplicate"],
    },
  ],
  assertions: [
    {
      name: "entitlements",
      pass: false,
      expected: 1,
      observed: 2,
      message: "Duplicate invoice.paid delivery created two entitlement records.",
    },
  ],
};

const singleRunFailure: RunReport = {
  ...failureReport,
  repeat: 1,
  repeatsFailed: 1,
  deliveries: [],
};

describe("renderTerminalReport", () => {
  it("runs the printed command in its documented shell with literal arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paymentchaos reproduce café "));
    try {
      const script = join(directory, "argv probe.cjs");
      await writeFile(script, "console.log(JSON.stringify(process.argv.slice(2)))");
      const scenarioRef = "café & receipts (renewal).yaml";
      const runArgs = ["--stable-ids", "--timeout-ms", "5000", "--allow-remote-target", "app.test"];
      const text = renderTerminalReport(failureReport, {
        cliCommand: [process.execPath, script],
        runArgs,
        scenarioRef,
        failedRepeatIndex: 4,
        color: false,
      });
      if (process.platform === "win32") {
        expect(text).toContain("Command Prompt (cmd.exe)");
        expect(text).toContain("From PowerShell, enter cmd.exe first");
      }
      const command = text.split("\n").find((line) => line.startsWith("reproduce: "));
      expect(command).toBeDefined();
      // Node uses cmd.exe on Windows and /bin/sh on POSIX, matching the report guidance.
      const result = spawnSync(command?.slice("reproduce: ".length) ?? "", {
        shell: true,
        encoding: "utf8",
        cwd: directory,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([
        "run",
        scenarioRef,
        "--seed",
        "1337",
        "--repeat",
        "20",
        "--repeat-index",
        "4",
        ...runArgs,
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("matches the BUILD_PROMPT §13 failure snapshot (timings normalized)", () => {
    const text = renderTerminalReport(failureReport, {
      scenarioRef: "renewal.yaml",
      scenarioRepeat: 20,
      failedRepeatIndex: 4,
      color: false,
    });
    expect(normalizeTerminalOutput(text)).toMatchInlineSnapshot(`
      "Deliveries
      #1  invoice.paid  evt_demo_1  attempt 1  200  <LATENCY>  duplicate
      #2  invoice.paid  evt_demo_2  attempt 2  200  <LATENCY>  duplicate

      Assertions
      ✗ Duplicate invoice.paid delivery created two entitlement records.
          expected: 1
          observed: 2

      reproduce: paymentchaos run renewal.yaml --seed 1337 --repeat 20 --repeat-index 4

      PAYMENTCHAOS FAILED  seed=1337  plan=7f3a…  repeat 4/20 failed
      "
    `);
  });

  it("prints reproduce once, after all assertions and before notes", () => {
    const report: RunReport = {
      ...singleRunFailure,
      assertions: [
        { name: "accepted", pass: true },
        { name: "entitlements", pass: false, expected: 1, observed: 5 },
        { name: "ledger", pass: false, expected: 1, observed: 5 },
      ],
    };
    const text = renderTerminalReport(report, {
      scenarioRef: "stripe-subscription-renewal",
      failedRepeatIndex: 1,
      notes: ["a caveat"],
      color: false,
    });
    expect(normalizeTerminalOutput(text)).toMatchInlineSnapshot(`
      "Deliveries

      Assertions
      ✓ accepted
      ✗ entitlements
          expected: 1
          observed: 5
      ✗ ledger
          expected: 1
          observed: 5

      reproduce: paymentchaos run stripe-subscription-renewal --seed 1337

      Notes
        a caveat

      PAYMENTCHAOS FAILED  seed=1337  plan=7f3a…
      "
    `);
    expect(text.match(/reproduce:/g)).toHaveLength(1);
  });

  it("omits --repeat-index and the repeat suffix when the run had one repetition", () => {
    const text = renderTerminalReport(singleRunFailure, {
      scenarioRef: "stripe-subscription-renewal",
      scenarioRepeat: 1,
      failedRepeatIndex: 1,
      color: false,
    });
    expect(text).toContain("reproduce: paymentchaos run stripe-subscription-renewal --seed 1337\n");
    expect(text).not.toContain("--repeat");
    expect(text).toMatch(/PAYMENTCHAOS FAILED {2}seed=1337 {2}plan=7f3a…\n$/);
  });

  it("keeps --repeat-index and the selected-repeat suffix when a repeat > 1 run was narrowed", () => {
    const text = renderTerminalReport(singleRunFailure, {
      scenarioRef: "stripe-subscription-renewal",
      scenarioRepeat: 20,
      failedRepeatIndex: 7,
      repeatSelection: true,
      color: false,
    });
    expect(text).toContain("--seed 1337 --repeat 20 --repeat-index 7\n");
    expect(text).toContain("selected repeat 7 of 20 failed (1 executed)");
  });

  it("prints no reproduce line for a passing run", () => {
    const text = renderTerminalReport(
      {
        ...singleRunFailure,
        status: "passed",
        repeatsFailed: 0,
        assertions: [{ name: "entitlements", pass: true }],
      },
      { scenarioRef: "stripe-subscription-renewal", color: false },
    );
    expect(text).not.toContain("reproduce:");
    expect(text).toMatch(/PAYMENTCHAOS PASSED {2}seed=1337 {2}plan=7f3a…\n$/);
  });

  it("caps long assertion names in the terminal but leaves the report untouched", () => {
    const name = `ledger: ${"one row per invoice, in the invoice currency, ".repeat(4).trim()}`;
    const report: RunReport = {
      ...singleRunFailure,
      status: "passed",
      repeatsFailed: 0,
      assertions: [{ name, pass: true }],
    };
    const text = renderTerminalReport(report, { scenarioRef: "x", color: false });
    const row = text.split("\n").find((line) => line.startsWith("✓ ledger:"));
    expect(row).toBeDefined();
    expect(Array.from(row ?? "").length).toBeLessThanOrEqual(82);
    expect(row?.endsWith("…")).toBe(true);
    expect(report.assertions[0]?.name).toBe(name);
    expect(JSON.parse(JSON.stringify(report)).assertions[0].name).toBe(name);
  });
});

describe("truncateAssertionName", () => {
  it("returns short names unchanged", () => {
    expect(truncateAssertionName("renewal_entitlements")).toBe("renewal_entitlements");
    expect(truncateAssertionName("x".repeat(80))).toBe("x".repeat(80));
  });

  it("cuts by code point so non-ASCII names stay valid", () => {
    const name = "山田太郎 Zoë Ångström محمد 💳".repeat(5);
    const cut = truncateAssertionName(name, 20);
    expect(Array.from(cut)).toHaveLength(20);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
