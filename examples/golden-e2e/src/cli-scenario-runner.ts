import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STRIPE_SUBSCRIPTION_RENEWAL } from "./builtin-scenarios.js";
import { CiDemoError } from "./ci-demo-error.js";
import { messages } from "./ci-demo-messages.js";
import { runCliProcess } from "./sandbox/process.js";
import type {
  ScenarioRunner,
  StripeSubscriptionRenewalRequest,
  StripeSubscriptionRenewalResult,
} from "./scenario-runner.js";
import { shellCommand } from "./shell-quote.js";

const goldenRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(goldenRoot, "..", "..");

function cliEntrypoint(): string {
  return join(repoRoot, "packages", "cli", "dist", "bin.js");
}

/**
 * `--import` needs a URL, not a Windows path. A literal space is valid in a file URL (Node
 * re-encodes it), and keeping `%20` would trip cmd.exe's `%` expansion for repositories
 * under paths like `C:\Users\Jane Doe`.
 */
function tsxLoaderSpecifier(): string {
  return import.meta.resolve("tsx").replaceAll("%20", " ");
}

function writeTempProject(options: {
  exampleDir: string;
  targetUrl: string;
  verifyCommand: string;
}): { projectDir: string; configPath: string } {
  const projectDir = mkdtempSync(join(tmpdir(), "paymentchaos-golden-"));
  const configPath = join(projectDir, "paymentchaos.config.yaml");
  const yaml = `version: 1
providers:
  stripe:
    target:
      url: ${JSON.stringify(options.targetUrl)}
      secret: \${STRIPE_WEBHOOK_SECRET}
assert:
  command: ${JSON.stringify(options.verifyCommand)}
`;
  writeFileSync(configPath, yaml, "utf8");
  return { projectDir, configPath };
}

interface CliRunnerOptions {
  readonly exampleDir: string;
  readonly verifyScriptRel?: string;
}

function prepareProject(options: CliRunnerOptions, request: StripeSubscriptionRenewalRequest) {
  const verifyScript = options.verifyScriptRel ?? "src/verify.ts";
  const base = new URL(request.targetWebhookUrl);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  const baseUrl = base.toString().replace(/\/$/, "");
  // The CLI runs this through /bin/sh or cmd.exe from a temp directory, so quote every
  // argument for that shell (node often lives under "Program Files" on Windows) and
  // resolve tsx from here.
  const verifyCommand = shellCommand(
    [
      process.execPath,
      "--import",
      tsxLoaderSpecifier(),
      join(options.exampleDir, verifyScript),
      "--base-url",
      baseUrl,
    ],
    process.platform,
  );
  const { projectDir } = writeTempProject({
    exampleDir: options.exampleDir,
    targetUrl: request.targetWebhookUrl,
    verifyCommand,
  });
  return {
    projectDir,
    cliArgs: ["run", STRIPE_SUBSCRIPTION_RENEWAL.name, "--seed", String(request.seed)],
    env: { ...process.env, STRIPE_WEBHOOK_SECRET: request.webhookSecret },
  };
}

async function removeProject(projectDir: string): Promise<void> {
  // Only the mkdtemp directory created above. A leftover temp directory (for example a
  // Windows file lock right after a killed process) must not mask the run's own result.
  await rm(projectDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

export interface CliReportResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs one machine-reporter invocation with a time limit. stdout and stderr stay separate
 * so a Node warning on stderr cannot break the stdout-equals-report check. Both streams
 * are checked for the signing secret before anything (including an error) carries them.
 */
export async function runCliReport(
  options: CliRunnerOptions,
  request: StripeSubscriptionRenewalRequest,
  invocation: {
    readonly label: string;
    readonly reporter: "json" | "junit";
    readonly outPath: string;
    readonly timeoutMs: number;
  },
): Promise<CliReportResult> {
  const { projectDir, cliArgs, env } = prepareProject(options, request);
  try {
    cliArgs.push("--reporter", invocation.reporter, "--out", invocation.outPath);
    const result = await runCliProcess(
      cliEntrypoint(),
      cliArgs,
      projectDir,
      env,
      invocation.timeoutMs,
    );
    const secret = request.webhookSecret;
    if (secret.length > 0 && (result.stdout.includes(secret) || result.stderr.includes(secret))) {
      throw new CiDemoError("SECRET_IN_OUTPUT", messages.secretInOutput(invocation.label));
    }
    if (result.timedOut) {
      throw new CiDemoError(
        "CLI_TIMEOUT",
        messages.cliTimeout(invocation.label, invocation.timeoutMs) +
          messages.stderrDiagnostic(result.stderr),
      );
    }
    if (result.failed) {
      throw new CiDemoError(
        "CLI_START_FAILED",
        messages.cliStartFailed(invocation.label) + messages.stderrDiagnostic(result.stderr),
      );
    }
    return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
  } finally {
    await removeProject(projectDir);
  }
}

export function createCliScenarioRunner(options: CliRunnerOptions): ScenarioRunner {
  return {
    async runStripeSubscriptionRenewal(
      request: StripeSubscriptionRenewalRequest,
    ): Promise<StripeSubscriptionRenewalResult> {
      const { projectDir, cliArgs, env } = prepareProject(options, request);
      try {
        const child = spawn(process.execPath, [cliEntrypoint(), ...cliArgs], {
          cwd: projectDir,
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

        const exitCode = await new Promise<number | null>((resolve, reject) => {
          child.on("error", reject);
          child.on("close", resolve);
        });

        return {
          deliveries: [],
          ids: {},
          stdout: stdout + stderr,
          exitCode: exitCode ?? 1,
        };
      } finally {
        await removeProject(projectDir);
      }
    },
  };
}
