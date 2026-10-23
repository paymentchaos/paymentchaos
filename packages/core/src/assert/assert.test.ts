import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commandAssertionResults, parseCommandOutput, runCommandAssertion } from "./command.ts";
import { buildCommandEnv, type RunMetadata } from "./env.ts";

const dir = mkdtempSync(join(tmpdir(), "paymentchaos-assert-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A command that runs `source` with this Node, quoted for both sh and cmd.exe. */
const script = (name: string, source: string, ...args: string[]) => {
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, source);
  return [process.execPath, file, ...args].map((part) => `"${part}"`).join(" ");
};

const metadata: RunMetadata = {
  runId: "run_test",
  seed: 1337,
  planHash: "abc123",
  repeatIndex: 2,
  ids: { customer: "cus_X", subscription: "sub_Y", event_2: "evt_Z" },
};

describe("buildCommandEnv", () => {
  const parentEnv = {
    PATH: "/usr/bin",
    HOME: "/home/dev",
    STRIPE_WEBHOOK_SECRET: "whsec_parent",
    AWS_SECRET_ACCESS_KEY: "nope",
    DATABASE_URL: "postgres://x",
  };

  it("passes only the allowlist plus PAYMENTCHAOS_* variables", () => {
    expect(buildCommandEnv(metadata, { parentEnv, platform: "linux" })).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/dev",
      PAYMENTCHAOS: "1",
      PAYMENTCHAOS_RUN_ID: "run_test",
      PAYMENTCHAOS_SEED: "1337",
      PAYMENTCHAOS_PLAN_HASH: "abc123",
      PAYMENTCHAOS_REPEAT_INDEX: "2",
      PAYMENTCHAOS_IDS_JSON: '{"customer":"cus_X","subscription":"sub_Y","event_2":"evt_Z"}',
      PAYMENTCHAOS_ID_CUSTOMER: "cus_X",
      PAYMENTCHAOS_ID_SUBSCRIPTION: "sub_Y",
      PAYMENTCHAOS_ID_EVENT_2: "evt_Z",
    });
  });

  it("passes explicitly opted-in variables", () => {
    const env = buildCommandEnv(metadata, {
      parentEnv,
      passEnv: ["DATABASE_URL"],
      platform: "linux",
    });
    expect(env.DATABASE_URL).toBe("postgres://x");
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  it("matches names case-insensitively on Windows only", () => {
    const winParent = { Path: "C:\\Windows", SystemRoot: "C:\\Windows", ComSpec: "cmd.exe" };
    const win = buildCommandEnv(metadata, { parentEnv: winParent, platform: "win32" });
    expect(win).toMatchObject(winParent);
    const posix = buildCommandEnv(metadata, { parentEnv: { Path: "/x" }, platform: "linux" });
    expect(posix.Path).toBeUndefined();
  });
});

describe("parseCommandOutput", () => {
  const doc = { checks: [{ name: "entitlements", pass: false, expected: 1, observed: 2 }] };

  it("accepts a whole-stdout document, compact or pretty", () => {
    expect(parseCommandOutput(JSON.stringify(doc)).result).toEqual(doc);
    expect(parseCommandOutput(JSON.stringify(doc, null, 2)).result).toEqual(doc);
  });

  it("finds the trailing document after banner lines", () => {
    const stdout = `\n> app@1.0.0 verify\n> node verify.js\n\n${JSON.stringify(doc, null, 2)}\n`;
    expect(parseCommandOutput(stdout).result).toEqual(doc);
  });

  it("treats empty or plain-text output as no document", () => {
    expect(parseCommandOutput("")).toEqual({});
    expect(parseCommandOutput("all good\n")).toEqual({});
  });

  it("reports JSON that breaks the protocol", () => {
    expect(parseCommandOutput('{"checks":[{"pass":"yes"}]}').protocolError).toMatch(
      /result document/,
    );
  });
});

describe("runCommandAssertion", () => {
  it("passes on exit 0 and fails on non-zero, keeping stderr", async () => {
    const ok = await runCommandAssertion(script("ok", "process.exit(0)"), { metadata });
    expect(ok).toMatchObject({ pass: true, exitCode: 0, attempts: 1 });
    const bad = await runCommandAssertion(
      script("bad", "console.error('two entitlements'); process.exit(3)"),
      { metadata },
    );
    expect(bad).toMatchObject({ pass: false, exitCode: 3 });
    expect(commandAssertionResults(bad)[0]?.message).toContain("two entitlements");
  });

  it("parses the JSON protocol, but the exit code decides the verdict", async () => {
    const doc = {
      checks: [
        { name: "entitlements", pass: false, expected: 1, observed: 2, message: "duplicate grant" },
      ],
    };
    const cmd = script(
      "json",
      `console.log("banner"); console.log(${JSON.stringify(JSON.stringify(doc))}); process.exit(1)`,
    );
    const outcome = await runCommandAssertion(cmd, { metadata });
    expect(outcome.checks).toEqual(doc.checks);
    expect(commandAssertionResults(outcome)).toEqual([
      {
        name: "assert.command exits 0",
        pass: false,
        message: expect.stringContaining("exited with 1"),
      },
      doc.checks[0],
    ]);
  });

  it("gives the command the documented environment and nothing secret", async () => {
    process.env.PAYMENTCHAOS_TEST_PARENT_SECRET = "whsec_should_not_leak";
    try {
      const cmd = script(
        "env",
        "console.log(JSON.stringify({ checks: [{ name: 'env', pass: true, observed: process.env }] }))",
      );
      const outcome = await runCommandAssertion(cmd, { metadata });
      const seen = outcome.checks[0]?.observed as Record<string, string>;
      expect(seen.PAYMENTCHAOS_ID_CUSTOMER).toBe("cus_X");
      expect(JSON.parse(seen.PAYMENTCHAOS_IDS_JSON ?? "{}")).toEqual(metadata.ids);
      expect(seen.PAYMENTCHAOS_TEST_PARENT_SECRET).toBeUndefined();
    } finally {
      delete process.env.PAYMENTCHAOS_TEST_PARENT_SECRET;
    }
  });

  it("settles: re-runs until the app catches up", async () => {
    const counter = join(dir, "counter");
    writeFileSync(counter, "0");
    const cmd = script(
      "settle",
      `import { readFileSync, writeFileSync } from "node:fs";
       const n = Number(readFileSync(process.argv[2], "utf8")) + 1;
       writeFileSync(process.argv[2], String(n));
       process.exit(n >= 3 ? 0 : 1);`,
      counter,
    );
    const outcome = await runCommandAssertion(cmd, {
      metadata,
      settle: { timeoutMs: 10_000, intervalMs: 10 },
    });
    expect(outcome).toMatchObject({ pass: true, attempts: 3 });
  });

  it("settles: gives up after timeoutMs with the last failure", async () => {
    const started = performance.now();
    const outcome = await runCommandAssertion(script("never", "process.exit(1)"), {
      metadata,
      settle: { timeoutMs: 300, intervalMs: 100 },
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.attempts).toBeGreaterThanOrEqual(2);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("kills a command that exceeds its timeout", async () => {
    const outcome = await runCommandAssertion(script("hang", "setTimeout(() => {}, 60_000)"), {
      metadata,
      timeoutMs: 300,
    });
    expect(outcome).toMatchObject({ pass: false, timedOut: true });
    expect(commandAssertionResults(outcome)[0]?.message).toMatch(/timed out/);
  });

  it("redacts secrets from captured output", async () => {
    const outcome = await runCommandAssertion(
      script("leak", "console.error('key=whsec_leaky'); process.exit(1)"),
      {
        metadata,
        redact: ["whsec_leaky"],
      },
    );
    expect(outcome.stderrTail).not.toContain("whsec_leaky");
  });
});
