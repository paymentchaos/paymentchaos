import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PaymentChaosError, scenarioSchema } from "../contracts/index.ts";
import { REDACTED } from "../safety/secrets.ts";
import { createFakeProvider } from "../testing/fake-provider.ts";
import { type RecordingServer, startRecordingServer } from "../testing/recording-server.ts";
import { runScenario } from "./run-scenario.ts";

// Synthetic signing secret. "/" changes under PHP's json_encode default, and the quote,
// backslash and non-ASCII letter change under every JSON encoder.
const SECRET = 'whsec_synthetic/hook+key"q\\é';
const env = { FAKE_SECRET: SECRET };
const adapter = createFakeProvider({ env });
const dir = mkdtempSync(join(tmpdir(), "paymentchaos-hook-redaction-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let server: RecordingServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const unicodeEscaped = (value: string) =>
  [...value].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
// Keys with escaped quotes, slashes and line separators must not derail the string scanner.
const KEY = JSON.stringify('we"ird/kéy\t\u2028');

const encodings: [string, string][] = [
  ["plain text", `secret=${SECRET}`],
  ["JSON", JSON.stringify({ [JSON.parse(KEY)]: SECRET })],
  ["JSON with escaped slashes", `{${KEY}:${JSON.stringify(SECRET).replaceAll("/", "\\/")}}`],
  ["JSON with \\u escapes", `{${KEY}:"${unicodeEscaped(SECRET)}"}`],
];
const leaks = [
  SECRET,
  JSON.stringify(SECRET).slice(1, -1),
  JSON.stringify(SECRET).slice(1, -1).replaceAll("/", "\\/"),
  unicodeEscaped(SECRET),
  "synthetic/hook",
  "synthetic\\/hook",
];

function failingHook(name: string, stderr: string): string {
  const file = join(dir, name);
  writeFileSync(file, `process.stderr.write(${JSON.stringify(`${stderr}\n`)}); process.exit(1);`);
  return `"${process.execPath}" "${file}"`;
}

async function hookError(phase: "beforeEach" | "afterEach", hook: string) {
  server = await startRecordingServer();
  const scenario = scenarioSchema.parse({
    version: 1,
    name: "hook output redaction",
    provider: "fake",
    flow: "subscription-renewal",
    params: { currency: "jpy" },
    target: { url: server.url, secret: "${FAKE_SECRET}" },
    hooks: { [phase]: hook },
  });
  const error = await runScenario(scenario, { adapter, env }).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PaymentChaosError);
  return error as PaymentChaosError;
}

describe("failed hook output", () => {
  for (const phase of ["beforeEach", "afterEach"] as const) {
    it.each(encodings)(`redacts a known secret printed by ${phase} as %s`, async (label, text) => {
      const error = await hookError(phase, failingHook(`${phase}-${label}.cjs`, text));
      expect(error.code).toBe("CONFIG_INVALID");
      expect(error.message).toContain(`hooks.${phase}`);
      expect(error.message).toContain(REDACTED);
      for (const leak of leaks) expect(error.message).not.toContain(leak);
      expect(JSON.stringify(error.details)).not.toContain("synthetic");
    });
  }

  it("redacts a known secret written literally into the hook command", async () => {
    const file = join(dir, "argv-hook.cjs");
    writeFileSync(file, "process.exit(1);");
    const hook = `"${process.execPath}" "${file}" ${JSON.stringify(SECRET)}`;
    const error = await hookError("beforeEach", hook);
    expect(error.message).toContain(REDACTED);
    expect(error.message).not.toContain("synthetic/hook");
  });
});
