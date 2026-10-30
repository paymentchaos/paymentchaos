import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSandbox } from "../examples/golden-e2e/src/sandbox/run.ts";
import { packPrivate, pnpm, run } from "./private-beta.mjs";
import { messages } from "./private-beta-messages.mjs";

const scratch = await mkdtemp(join(tmpdir(), "paymentchaos-private-install-"));
try {
  const { tarball, version } = await packPrivate(join(scratch, "archives"));
  const prefix = join(scratch, "installed café tool");
  // Empty cache plus offline mode proves the archive supplies every runtime dependency.
  pnpm([
    "exec",
    "npm",
    "install",
    "--global",
    "--prefix",
    prefix,
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache",
    join(scratch, "empty-cache"),
    tarball,
  ]);
  const packagePath = join(
    prefix,
    ...(process.platform === "win32" ? [] : ["lib"]),
    "node_modules",
    "paymentchaos",
  );
  const installed = JSON.parse(await readFile(join(packagePath, "package.json"), "utf8"));
  assert.equal(installed.version, version);
  assert.equal(installed.private, true);
  assert(
    existsSync(
      join(prefix, process.platform === "win32" ? "paymentchaos.cmd" : "bin/paymentchaos"),
    ),
  );
  const bin = join(packagePath, "dist", "bin.js");
  delete process.env.NODE_PATH;
  delete process.env.NODE_OPTIONS;
  assert.equal(run(process.execPath, [bin, "--version"], scratch).trim(), version);
  const { results } = await runSandbox(join(scratch, "cases"), bin);
  assert.equal(results.length, 63);
  assert.deepEqual(
    results.filter((result) => !result.pass),
    [],
  );
  console.log(messages.installed(results.length));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
