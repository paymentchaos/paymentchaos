import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runShellCommand } from "./shell.ts";

const dir = mkdtempSync(join(tmpdir(), "paymentchaos-shell-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const node = (file: string) => `"${process.execPath}" "${file}"`;
const kill = (pid: number) => {
  try {
    process.kill(pid);
  } catch {
    // Already gone.
  }
};

/** A script that starts a detached process holding stdout and stderr open, then runs `rest`. */
const holdPipes = (name: string, rest: string) => {
  const file = join(dir, `${name}.mjs`);
  writeFileSync(
    file,
    `import { spawn } from "node:child_process";
     import { writeFileSync } from "node:fs";
     const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"],
       { stdio: ["ignore", "inherit", "inherit"], detached: true });
     holder.unref();
     writeFileSync(${JSON.stringify(join(dir, `${name}.pid`))}, String(holder.pid));
     ${rest}`,
  );
  return { command: node(file), pidFile: join(dir, `${name}.pid`) };
};

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

  it.skipIf(process.platform === "win32")(
    "keeps output after the command prints its launcher's command line",
    async () => {
      const doc = JSON.stringify({ checks: [{ name: "business state", pass: false }] });
      const result = await runShellCommand(
        `ps -o args= -p "$PPID"; ps eww -o command= -p "$PPID"; printf '%s\\n' '${doc}'`,
        { env, timeoutMs: 60_000 },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trimEnd().endsWith(doc)).toBe(true);
    },
  );

  it("runs a command that looks like a Node option through the shell", async () => {
    const result = await runShellCommand("--version", { env, timeoutMs: 60_000 });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain(process.version);
  });

  it("keeps the last output of a timed-out command whose pipes stay open", async () => {
    const { command, pidFile } = holdPipes(
      "held-timeout",
      `process.stdout.write("foreground diagnostic\\n");
       process.stderr.write("stderr diagnostic\\n");
       setTimeout(() => {}, 60000);`,
    );
    const result = await runShellCommand(command, { env, timeoutMs: 1_000 });
    kill(Number(readFileSync(pidFile, "utf8")));
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toBe("foreground diagnostic\n");
    expect(result.stderr).toBe("stderr diagnostic\n");
  });

  // POSIX only: the script finds the launcher, its parent or grandparent, with ps.
  it.skipIf(process.platform === "win32")(
    "times out when the launcher dies without a marker and the pipes stay open",
    async () => {
      const { command, pidFile } = holdPipes(
        "launcher-crash",
        `import { execFileSync } from "node:child_process";
         process.stdout.write("before crash\\n");
         const ps = (field, pid) => execFileSync("ps", ["-o", field + "=", "-p", String(pid)], { encoding: "utf8" }).trim();
         const launcher = ps("args", process.ppid).includes(" -e ") ? process.ppid : Number(ps("ppid", process.ppid));
         process.kill(launcher, "SIGKILL");
         setTimeout(() => {}, 60000);`,
      );
      const started = performance.now();
      const result = await runShellCommand(command, { env, timeoutMs: 500 });
      kill(Number(readFileSync(pidFile, "utf8")));
      expect(result.timedOut).toBe(true);
      expect(result.stdout).toBe("before crash\n");
      expect(performance.now() - started).toBeLessThan(5_000);
    },
    20_000,
  );

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
