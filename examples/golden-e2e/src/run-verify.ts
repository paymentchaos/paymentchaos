import { spawn } from "node:child_process";
import { join } from "node:path";

export interface VerifyRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function runVerifyScript(options: {
  exampleDir: string;
  customerId: string;
  baseUrl: string;
  env?: Record<string, string>;
}): Promise<VerifyRunResult> {
  const verifyPath = join(options.exampleDir, "src", "verify.ts");
  const env = {
    ...process.env,
    PAYMENTCHAOS_ID_CUSTOMER: options.customerId,
    PAYMENTCHAOS_STATE_BASE_URL: options.baseUrl,
    ...options.env,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", verifyPath], {
      cwd: options.exampleDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

export interface CheckRecord {
  name: string;
  pass: boolean;
  expected: string;
  observed: string;
  message: string;
}

export function parseChecks(stdout: string): CheckRecord[] {
  const line = stdout
    .trim()
    .split("\n")
    .find((row) => row.startsWith("{"));
  if (!line) {
    return [];
  }
  const parsed = JSON.parse(line) as { checks?: CheckRecord[] };
  return parsed.checks ?? [];
}
