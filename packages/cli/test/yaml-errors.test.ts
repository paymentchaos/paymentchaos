import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExitCode, PaymentChaosError } from "@paymentchaos/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { loadProjectConfig, loadScenarioFile } from "../src/yaml/load.ts";

// A synthetic stand-in for a credential pasted literally into YAML. It is never a real key.
const CANARY = "SYNTHETIC_CANARY_9f3c_not_a_secret";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "paymentchaos-yaml-errors-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function scenario(body: string): string {
  const file = path.join(dir, "s.yaml");
  writeFileSync(file, `version: 1\nname: s\nprovider: stripe\nflow: subscription-renewal\n${body}`);
  return file;
}

async function loadError(file: string): Promise<PaymentChaosError> {
  const error = await loadScenarioFile(file).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PaymentChaosError);
  return error as PaymentChaosError;
}

const bomb = [
  "a: &a [x, x, x, x, x, x, x, x, x, x]",
  "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
  "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
  "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
  "e: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]",
].join("\n");

describe("YAML syntax and alias errors never echo source text", () => {
  it.each([
    ["an unterminated flow sequence", `target:\n  secret: [${CANARY}\n`, 7, "BAD_INDENT"],
    ["an unterminated double quote", `target:\n  secret: "${CANARY}\n`, 7, "MISSING_CHAR"],
    ["an unterminated single quote", `target:\n  secret: '${CANARY}\n`, 7, "MISSING_CHAR"],
    ["a duplicate key", `${CANARY}: 1\n${CANARY}: 2\n`, 6, "DUPLICATE_KEY"],
  ])("reports file:line:col and the code for %s", async (_label, body, line, code) => {
    const file = scenario(body);
    const error = await loadError(file);
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toMatch(
      new RegExp(`s\\.yaml:${line}:\\d+: YAML syntax error \\(${code}\\) — `),
    );
    expect(error.message).not.toContain(CANARY);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error.details)).not.toContain(CANARY);
    expect(error.details).toMatchObject({ file, line, yamlCode: code });
  });

  it("locates an unresolved alias without naming it", async () => {
    const error = await loadError(scenario(`seed: *${CANARY}\n`));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toMatch(/s\.yaml:5:7: YAML alias has no matching anchor — /);
    expect(error.message).not.toContain(CANARY);
    expect(error.cause).toBeUndefined();
  });

  it("turns an alias bomb into a config error instead of an internal error", async () => {
    const error = await loadError(scenario(`${bomb}\n`));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toMatch(/s\.yaml:6:\d+: YAML aliases expand to too many nodes — /);
  });

  it.each([
    ["at the top level", `${CANARY}: 1\n`, "s\\.yaml:5:1"],
    [
      "inside a nested object",
      `target:\n  url: http://127.0.0.1:9/\n  ${CANARY}: 1\n`,
      "s\\.yaml:7:3",
    ],
  ])("points at an unrecognized key %s without quoting it", async (_label, body, location) => {
    const error = await loadError(scenario(body));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toMatch(
      new RegExp(`${location}: unrecognized key — remove the unknown key`),
    );
    expect(error.message).not.toContain(CANARY);
    expect(JSON.stringify(error.details)).not.toContain(CANARY);
  });

  it("applies the same rules to the project config", async () => {
    writeFileSync(path.join(dir, "paymentchaos.config.yaml"), `version: 1\nsecret: "${CANARY}\n`);
    const error = await loadProjectConfig(dir).then(
      () => undefined,
      (e: unknown) => e as PaymentChaosError,
    );
    expect(error?.code).toBe("CONFIG_INVALID");
    expect(error?.message).toMatch(/paymentchaos\.config\.yaml:3:\d+: YAML syntax error/);
    expect(error?.message).not.toContain(CANARY);
  });
});

describe("paymentchaos run with malformed YAML", () => {
  let stderr: string;

  beforeEach(() => {
    stderr = "";
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      stderr += `${parts.map(String).join(" ")}\n`;
    });
    process.exitCode = undefined;
  });

  it.each([
    ["a pasted literal in a broken flow sequence", `target:\n  secret: [${CANARY}\n`],
    ["an alias bomb", `${bomb}\n`],
  ])("exits with the config code and keeps %s out of stderr", async (_label, body) => {
    const file = scenario(body);
    for (const reporter of ["terminal", "json", "junit"]) {
      stderr = "";
      process.exitCode = undefined;
      await runCli(["run", file, "--reporter", reporter]);
      expect(Number(process.exitCode), stderr).toBe(ExitCode.Config);
      expect(stderr).toContain("s.yaml:");
      expect(stderr).not.toContain(CANARY);
    }
  });
});
