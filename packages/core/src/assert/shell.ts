import { type ChildProcessByStdio, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import { messages } from "../messages.ts";

/**
 * Run a user command through the platform shell: `/bin/sh -c` on macOS and Linux,
 * `cmd.exe /d /s /c` on Windows (Node's `shell: true`). Quoting therefore follows that
 * shell's rules. See https://nodejs.org/api/child_process.html#shell-requirements
 */

const OUTPUT_LIMIT = 1024 * 1024;

export interface ShellOptions {
  readonly env: Record<string, string>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ShellResult {
  /** `null` when the process was killed (timeout, abort or signal). */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** Set when the command could not be started at all. */
  readonly spawnError?: string;
}

/** Keep the last `OUTPUT_LIMIT` bytes: a result document is printed last. */
function collector() {
  let chunks: Buffer[] = [];
  let size = 0;
  return {
    push(chunk: Buffer) {
      chunks.push(chunk);
      size += chunk.length;
      if (size > OUTPUT_LIMIT * 2) {
        const all = Buffer.concat(chunks).subarray(-OUTPUT_LIMIT);
        chunks = [all];
        size = all.length;
      }
    },
    text: () => Buffer.concat(chunks).subarray(-OUTPUT_LIMIT).toString("utf8"),
  };
}

/**
 * Marks where the command's output ends. Node can report that the shell exited before it
 * has read the shell's last output, so no timer can tell that output from what a
 * background process writes afterwards. Instead this launcher, run by the same Node binary,
 * runs the command through the shell exactly as `shell: true` would, blocks until the shell
 * exits, and then writes a marker to stdout and stderr. A pipe keeps bytes in write order:
 * everything written before the shell exited comes before the marker.
 *
 * The command, marker and NODE_OPTIONS arrive on stdin, not in argv or the environment: the
 * command can't see the marker (`ps` shows argv), and Node can't mistake a command such as
 * `--version` for one of its own options.
 */
const LAUNCHER = `
const { spawnSync } = require("node:child_process");
const { writeSync } = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const { command, marker, nodeOptions } = JSON.parse(input);
  const env = { ...process.env };
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  let result;
  try {
    result = spawnSync(command, { shell: true, env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
  } catch (error) {
    result = { error };
  }
  if (result.error) writeSync(2, String(result.error.code ?? "spawn failed"));
  writeSync(1, marker);
  writeSync(2, marker);
  if (result.signal) {
    process.kill(process.pid, result.signal);
    // Node ignores SIGPIPE and handles SIGUSR1, so those would otherwise read as exit 1.
    process.kill(process.pid, "SIGKILL");
  }
  process.exit(result.error ? 127 : (result.status ?? 1));
});
`;

/** What the launcher reads from stdin, and its environment without NODE_OPTIONS. */
function launcherInput(command: string, marker: string, env: Record<string, string>) {
  const launcherEnv: Record<string, string> = {};
  let nodeOptions: string | undefined;
  for (const [name, value] of Object.entries(env)) {
    // Windows variable names are case-insensitive.
    const isNodeOptions =
      process.platform === "win32"
        ? name.toUpperCase() === "NODE_OPTIONS"
        : name === "NODE_OPTIONS";
    if (isNodeOptions) nodeOptions = value;
    else launcherEnv[name] = value;
  }
  return { stdin: JSON.stringify({ command, marker, nodeOptions }), env: launcherEnv };
}

/** Collect a stream up to the marker, then drop everything after it. */
function untilMarker(marker: Buffer, onDone: () => void) {
  const out = collector();
  let pending: Buffer = Buffer.alloc(0);
  let done = false;
  const complete = () => {
    done = true;
    onDone();
  };
  return {
    get done() {
      return done;
    },
    push(chunk: Buffer) {
      if (done) return;
      const bytes = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      const at = bytes.indexOf(marker);
      if (at !== -1) {
        out.push(bytes.subarray(0, at));
        complete();
        return;
      }
      // Hold back a possible partial marker until the next chunk.
      const keep = Math.max(0, bytes.length - (marker.length - 1));
      out.push(bytes.subarray(0, keep));
      pending = bytes.subarray(keep);
    },
    /** The pipe closed, or the result is final, without a marker: keep what was held back. */
    end() {
      if (done) return;
      out.push(pending);
      complete();
    },
    text: out.text,
  };
}

/**
 * Kill the whole process tree: the shell plus whatever it started (npm, node, …). On Windows
 * this waits for `taskkill`, so the tree is gone before the run goes on or PaymentChaos exits.
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    // Fails harmlessly if the shell has already exited.
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 10_000,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already exited.
  }
}

/**
 * The command is done when its shell exits, and its output is what was written before then
 * (or within the launcher's reaction time after it: usually well under a millisecond, a few
 * milliseconds on a loaded machine). Processes it
 * left in the background keep running: their later output is still read but discarded, so
 * they neither block on a full pipe nor fail with EPIPE, can't change the verdict, and the
 * pipes no longer keep PaymentChaos alive. A timeout or an abort before
 * every pipe closes kills the whole process group, background members included.
 *
 * Windows has no process groups, so there a timeout or an abort reaches only what is still a
 * descendant of a running command. `taskkill /T` walks parent PIDs, which lead nowhere once the
 * shell and its launcher have exited, so processes left in the background keep running.
 */
export function runShellCommand(command: string, options: ShellOptions): Promise<ShellResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    let timedOut = false;
    let killed = false;
    let exited = false;
    let finished = false;
    let exitCode: number | null | undefined;
    let spawnError: string | undefined;
    const marker = `paymentchaos-end-${randomUUID()}`;
    const launcher = launcherInput(command, marker, options.env);
    // Node's argument errors (a NUL byte, say) quote the whole command, which may hold a
    // credential, so only the error code is kept.
    const notStarted = (code: unknown) =>
      resolve({
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        durationMs: performance.now() - started,
        spawnError: messages.commandNotStarted(typeof code === "string" ? code : "unknown"),
      });
    // The launcher would refuse these too, but too late to report it as not started.
    if (command === "" || command.includes("\0")) {
      notStarted("ERR_INVALID_ARG_VALUE");
      return;
    }
    let child: ChildProcessByStdio<Writable, Readable, Readable>;
    try {
      child = spawn(process.execPath, ["-e", LAUNCHER], {
        env: launcher.env,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        // Own process group on POSIX so a timeout or abort can kill the whole tree.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      notStarted((error as NodeJS.ErrnoException).code);
      return;
    }
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            kill();
          }, options.timeoutMs);
    const kill = () => {
      killed = true;
      // On Windows an exited launcher's PID no longer leads taskkill to the tree and may belong
      // to another process by now. On POSIX the process group outlives its leader.
      if (!(process.platform === "win32" && exited)) killTree(child.pid);
      // A launcher that already exited without a marker sends no further event, and a
      // background process may hold the pipes open.
      if (exited) finish();
    };
    const onAbort = () => {
      // The timeout would only try to kill the same tree again.
      if (timer !== undefined) clearTimeout(timer);
      kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    // A listener added to an already-aborted signal never fires.
    if (options.signal?.aborted === true) onAbort();

    const finish = () => {
      if (finished || !exited) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      stdout.end();
      stderr.end();
      // Pipes from `stdio: "pipe"` are sockets; typed as plain Readables.
      (child.stdout as Socket).unref();
      (child.stderr as Socket).unref();
      resolve({
        exitCode: exitCode ?? null,
        timedOut,
        stdout: stdout.text(),
        stderr: stderr.text(),
        durationMs: performance.now() - started,
        ...(spawnError === undefined ? {} : { spawnError }),
      });
    };

    const markerBytes = Buffer.from(marker);
    const settled = () => {
      if (stdout.done && stderr.done) finish();
    };
    const stdout = untilMarker(markerBytes, settled);
    const stderr = untilMarker(markerBytes, settled);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdout.on("end", () => stdout.end());
    child.stderr.on("end", () => stderr.end());
    // The launcher may die before reading its input.
    child.stdin.on("error", () => {});
    child.stdin.end(launcher.stdin);
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("exit", (code) => {
      exitCode = code;
      exited = true;
      // A killed launcher writes no marker, and a background process may hold the pipes open.
      if (killed) finish();
      else settled();
    });
    child.on("close", (code) => {
      exitCode ??= code;
      exited = true;
      options.signal?.removeEventListener("abort", onAbort);
      finish();
    });
  });
}
