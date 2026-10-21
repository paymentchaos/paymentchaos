import { spawn } from "node:child_process";

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

export function runShellCommand(command: string, options: ShellOptions): Promise<ShellResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const stdout = collector();
    const stderr = collector();
    let timedOut = false;
    let spawnError: string | undefined;
    const child = spawn(command, {
      shell: true,
      env: options.env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Own process group on POSIX so a timeout can kill the whole tree.
      detached: process.platform !== "win32",
    });
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            killTree(child.pid);
          }, options.timeoutMs);
    const onAbort = () => killTree(child.pid);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: code,
        timedOut,
        stdout: stdout.text(),
        stderr: stderr.text(),
        durationMs: performance.now() - started,
        ...(spawnError === undefined ? {} : { spawnError }),
      });
    });
  });
}
