import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runShellCommand } from "./shell.ts";

const dir = mkdtempSync(join(tmpdir(), "paymentchaos-shell-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

describe("runShellCommand", () => {
  // Node can report a shell's exit before it has read the shell's last output, most often when
  // many processes start and exit at once. None of that output may be lost.
  it("keeps all of the command's own output while many commands start and exit", async () => {
    const writer = join(dir, "writer.mjs");
    writeFileSync(
      writer,
      `import { writeSync } from "node:fs";
       const doc = JSON.stringify({ checks: [{ name: "own", pass: false, pad: "x".repeat(Number(process.argv[2])) }] });
       writeSync(1, doc); writeSync(2, doc);`,
    );
    const expected = (size: number) =>
      JSON.stringify({ checks: [{ name: "own", pass: false, pad: "x".repeat(size) }] });
    // From a short line to several pipe buffers; `cd .` makes the command compound in sh and cmd.
    const cases = Array.from({ length: 96 }, (_, i) => {
      const size = [10, 6_000, 200_000, 600_000][i % 4] as number;
      const run = `"${process.execPath}" "${writer}" ${String(size)}`;
      return { size, command: i % 2 === 0 ? run : `cd . && ${run} && cd .` };
    });
    let next = 0;
    const failures: string[] = [];
    const worker = async () => {
      for (let i = next++; i < cases.length; i = next++) {
        const { size, command } = cases[i] as (typeof cases)[number];
        const result = await runShellCommand(command, { env, timeoutMs: 60_000 });
        const want = expected(size);
        if (result.exitCode !== 0 || result.stdout !== want || result.stderr !== want) {
          failures.push(
            `#${String(i)} exit=${String(result.exitCode)} stdout=${String(result.stdout.length)}/${String(want.length)} stderr=${String(result.stderr.length)}/${String(want.length)}`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: 48 }, worker));
    expect(failures).toEqual([]);
  }, 120_000);

  it("passes NODE_OPTIONS to the command but not to its launcher", async () => {
    const preload = join(dir, "preload.cjs");
    writeFileSync(preload, `process.stderr.write("preloaded:" + process.pid + "\\n");`);
    const probe = join(dir, "probe.mjs");
    writeFileSync(probe, `console.log("ran:" + process.pid);`);
    const result = await runShellCommand(`"${process.execPath}" "${probe}"`, {
      // NODE_OPTIONS treats a backslash inside quotes as an escape; Windows accepts "/".
      env: { ...env, NODE_OPTIONS: `--require "${preload.replaceAll("\\", "/")}"` },
      timeoutMs: 60_000,
    });
    expect(result.exitCode).toBe(0);
    const ran = /ran:(\d+)/.exec(result.stdout)?.[1];
    const preloaded = [...result.stderr.matchAll(/preloaded:(\d+)/g)].map((m) => m[1]);
    expect(preloaded).toEqual([ran]);
  });
});
