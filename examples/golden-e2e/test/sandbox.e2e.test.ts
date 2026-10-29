import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createHarness } from "../src/sandbox/harness.ts";
import { messages } from "../src/sandbox/messages.ts";
import { runSandbox } from "../src/sandbox/run.ts";

it("passes the private sandbox matrix against the built CLI", async () => {
  const root = await mkdtemp(join(tmpdir(), "paymentchaos-sandbox-"));
  try {
    const { results } = await runSandbox(root);
    expect(results.length).toBeGreaterThan(60);
    expect(results.filter((r) => !r.pass)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

it("detects and redacts an override signing key echoed by a CLI error", async () => {
  const root = await mkdtemp(join(tmpdir(), "paymentchaos-sandbox-redaction-"));
  try {
    const harness = await createHarness(root);
    const override = `whsec_${randomBytes(32).toString("hex")}`;
    try {
      await harness.test("override key leak", async (t) => {
        // An unknown command echoes its argument before a scenario resolves signing keys.
        await t.cli([override], 2, undefined, { PC_SANDBOX_SECRET: override });
      });
    } finally {
      await harness.finish();
    }
    expect(harness.results).toEqual([
      { name: "override key leak", pass: false, error: messages.secretLeak },
    ]);
    const saved = await readFile(join(harness.directory, "01 café app", "command-1.log"), "utf8");
    expect(saved.includes(override.slice(6))).toBe(false);
    expect(saved).toContain("[REDACTED]");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("terminates a hanging assertion and its child before the next case", async () => {
  const root = await mkdtemp(join(tmpdir(), "paymentchaos-sandbox-timeout-"));
  const harness = await createHarness(root, 5000);
  let pids: number[] = [];
  try {
    await harness.test("hanging assertion", async (t) => {
      await t.configure("stripe", ["invoice.paid", "customer.subscription.updated"]);
      await t.write(
        "verify.mjs",
        `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
writeFileSync('pids.json', JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);
`,
      );
      await t.cli(["run", "stripe-subscription-renewal", "--seed", "1337"], 0);
    });
    pids = JSON.parse(await readFile(join(harness.directory, "01 café app", "pids.json"), "utf8"));
    expect(harness.results[0]?.pass).toBe(false);
    expect(pids).toHaveLength(2);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    await harness.test("still usable after timeout", async (t) => {
      await t.cli(["flows"], 0, "Lifecycle packs");
    });
    expect(harness.results[1]?.pass).toBe(true);
  } finally {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
    await harness.finish();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
