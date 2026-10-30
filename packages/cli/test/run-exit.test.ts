import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExitCode } from "@paymentchaos/core";
import { type RecordingServer, startRecordingServer } from "@paymentchaos/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";

// Every documented exit code (ADR 0005), through the same entry point bin.ts calls. runCli
// must report through process.exitCode and never call process.exit(), so a call here that
// tried to exit would end the test worker instead of returning.

let dir: string;
let server: RecordingServer | undefined;
let stdout: string;
let stderr: string;

function writeProject(targetUrl: string): void {
  writeFileSync(
    path.join(dir, "paymentchaos.config.yaml"),
    `version: 1
providers:
  stripe:
    target:
      url: ${JSON.stringify(targetUrl)}
      secret: \${STRIPE_WEBHOOK_SECRET}
`,
    "utf8",
  );
  mkdirSync(path.join(dir, "paymentchaos", "scenarios"), { recursive: true });
  writeFileSync(
    path.join(dir, "paymentchaos", "scenarios", "tiny.yaml"),
    "version: 1\nname: tiny\nprovider: stripe\nflow: subscription-renewal\n",
    "utf8",
  );
}

async function run(args: string[]): Promise<number | undefined> {
  await runCli(args);
  const code = process.exitCode;
  return code === undefined ? undefined : Number(code);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "paymentchaos-exit-"));
  stdout = "";
  stderr = "";
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${String(code)}) called`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    stderr += `${parts.map(String).join(" ")}\n`;
  });
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_cli_exit_code_test");
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await server?.close();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("paymentchaos run exit codes", () => {
  it("exits 2 without sending or reporting success for an unsupported HTTP assertion", async () => {
    server = await startRecordingServer();
    writeProject(server.url);
    appendFileSync(
      path.join(dir, "paymentchaos.config.yaml"),
      `assert:\n  http:\n    url: ${server.url}\n    expect: { '$.entitlements': 1 }\n`,
    );
    expect(await run(["run", "stripe-subscription-renewal", "--seed", "1337"])).toBe(
      ExitCode.Config,
    );
    expect(stderr).toContain("use assert.command");
    expect(stdout).not.toContain("PAYMENTCHAOS PASSED");
    expect(server.requests).toHaveLength(0);
  });

  it("exits 0 and prints the full report when every check passes", async () => {
    server = await startRecordingServer();
    writeProject(server.url);
    expect(await run(["run", "paymentchaos/scenarios/tiny.yaml", "--seed", "1"])).toBe(ExitCode.Ok);
    expect(stdout).toMatch(/PAYMENTCHAOS PASSED {2}seed=1 {2}plan=\S+\n$/);
  });

  it("exits 1 and still prints the full report when an assertion fails", async () => {
    server = await startRecordingServer((_req, res) => {
      res.writeHead(500).end();
    });
    writeProject(server.url);
    expect(await run(["run", "paymentchaos/scenarios/tiny.yaml", "--seed", "1"])).toBe(
      ExitCode.AssertionFailed,
    );
    expect(stdout).toContain("reproduce: ");
    expect(stdout).toContain("bin.js");
    expect(stdout).not.toContain("npx");
    expect(stdout).toMatch(/PAYMENTCHAOS FAILED {2}seed=1 {2}plan=\S+\n$/);
  });

  it("exits 2 for a usage error", async () => {
    expect(await run(["run"])).toBe(ExitCode.Config);
    expect(stderr).toContain("Provide at least one scenario name or file path.");
  });

  it("exits 2 for an unknown command", async () => {
    expect(await run(["bogus"])).toBe(ExitCode.Config);
    expect(stderr).toContain("Unknown command");
  });

  it("exits 3 when the target is unreachable", async () => {
    writeProject("http://127.0.0.1:1/webhooks/stripe");
    expect(await run(["run", "paymentchaos/scenarios/tiny.yaml", "--seed", "1"])).toBe(
      ExitCode.TargetUnreachable,
    );
  });
});
