import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { messages } from "./messages.ts";

const exec = promisify(execFile);

export class SandboxCleanupError extends Error {
  constructor(cause: unknown) {
    super(messages.cleanupFailed, { cause });
  }
}

async function processTable() {
  const { stdout } = await exec("ps", ["-A", "-o", "pid=,ppid=,stat="], {
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, parent, state = ""] = line.trim().split(/\s+/);
      return { pid: Number(pid), parent: Number(parent), zombie: state.startsWith("Z") };
    });
}

/** Core commands use separate POSIX process groups, so killing only the CLI misses them. */
async function terminateTree(pid: number) {
  if (process.platform === "win32") {
    await exec("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 5000,
    });
    return;
  }
  const table = await processTable();
  const descendants = (parent: number): number[] =>
    table
      .filter((row) => row.parent === parent)
      .flatMap((row) => [...descendants(row.pid), row.pid]);
  // Leaves first lets their still-running parents reap them before those parents exit.
  for (const target of [...descendants(pid), pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    for (let attempt = 0; ; attempt++) {
      if (!(await processTable()).some((row) => row.pid === target && !row.zombie)) break;
      if (attempt === 20) throw new Error(messages.cleanupFailed);
      await sleep(25);
    }
  }
}

export async function runCliProcess(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) {
  let cleanup: Promise<void> | undefined;
  let timedOut = false;
  const result = await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
    failed: boolean;
  }>((resolve) => {
    const child = execFile(
      process.execPath,
      [bin, ...args],
      { cwd, env, maxBuffer: 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        resolve({
          code: error && typeof error.code === "number" ? error.code : error ? -1 : 0,
          stdout,
          stderr,
          failed: !!error && typeof error.code !== "number",
        });
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        cleanup = terminateTree(child.pid).finally(() => child.kill("SIGKILL"));
        // Attach immediately: the CLI callback may arrive after a cleanup error.
        void cleanup.catch(() => {});
      }
    }, timeoutMs);
  });
  try {
    await cleanup;
  } catch (error) {
    throw new SandboxCleanupError(error);
  }
  return { ...result, failed: result.failed || timedOut };
}
