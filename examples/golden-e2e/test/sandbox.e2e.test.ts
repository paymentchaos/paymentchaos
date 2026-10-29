import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
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
