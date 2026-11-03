import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Socket } from "node:net";
import type { Readable } from "node:stream";
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

/** Kill the whole process tree: the shell plus whatever it started (npm, node, …). */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Already exited.
  }
}

/**
 * The command is done when the shell exits, and its output is what it wrote before then.
 * Processes it left in the background keep running: their output is still read but
 * discarded, so they neither block on a full pipe nor fail with EPIPE, can't change the
 * verdict, and the pipes no longer keep PaymentChaos alive. A timeout or an abort before
 * every pipe closes kills the whole process group, background members included.
 */
export function runShellCommand(command: string, options: ShellOptions): Promise<ShellResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const stdout = collector();
    const stderr = collector();
    let timedOut = false;
    let finished = false;
    let exitCode: number | null | undefined;
    let spawnError: string | undefined;
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(command, {
        shell: true,
        env: options.env,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // Own process group on POSIX so a timeout or abort can kill the whole tree.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      // Node's argument errors (a NUL byte, say) quote the whole command, which may hold a
      // credential, so only the error code is kept.
      const code = (error as NodeJS.ErrnoException).code;
      resolve({
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        durationMs: performance.now() - started,
        spawnError: messages.commandNotStarted(typeof code === "string" ? code : "unknown"),
      });
      return;
    }
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            killTree(child.pid);
          }, options.timeoutMs);
    const onAbort = () => killTree(child.pid);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    // A listener added to an already-aborted signal never fires.
    if (options.signal?.aborted === true) onAbort();

    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
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

    child.stdout.on("data", (chunk: Buffer) => {
      if (!finished) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!finished) stderr.push(chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("exit", (code) => {
      exitCode = code;
      if (timer !== undefined) clearTimeout(timer);
      // Bytes written before the exit are already in the pipe and are read by the end of the
      // event-loop turn that reports it. Anything later comes from the background.
      setImmediate(finish);
    });
    child.on("close", (code) => {
      exitCode ??= code;
      options.signal?.removeEventListener("abort", onAbort);
      finish();
    });
  });
}
