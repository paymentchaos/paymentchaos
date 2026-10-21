import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STRIPE_SUBSCRIPTION_RENEWAL } from "./builtin-scenarios.js";
import type {
  ScenarioRunner,
  StripeSubscriptionRenewalRequest,
  StripeSubscriptionRenewalResult,
} from "./scenario-runner.js";

const goldenRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(goldenRoot, "..", "..");

function cliEntrypoint(): string {
  return join(repoRoot, "packages", "cli", "dist", "bin.js");
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

export function createCliScenarioRunner(options: {
  exampleDir: string;
  verifyScriptRel?: string;
}): ScenarioRunner {
  return {
    async runStripeSubscriptionRenewal(
      request: StripeSubscriptionRenewalRequest,
    ): Promise<StripeSubscriptionRenewalResult> {
      const verifyScript = options.verifyScriptRel ?? "src/verify.ts";
      const base = new URL(request.targetWebhookUrl);
      base.pathname = "/";
      base.search = "";
      base.hash = "";
      const baseUrl = base.toString().replace(/\/$/, "");
      const verifyCommand = `${process.execPath} --import tsx ${join(options.exampleDir, verifyScript)} --base-url ${baseUrl}`;

      const { projectDir } = writeTempProject({
        exampleDir: options.exampleDir,
        targetUrl: request.targetWebhookUrl,
        verifyCommand,
      });

      const child = spawn(
        process.execPath,
        [cliEntrypoint(), "run", STRIPE_SUBSCRIPTION_RENEWAL.name, "--seed", String(request.seed)],
        {
          cwd: projectDir,
          env: {
            ...process.env,
            STRIPE_WEBHOOK_SECRET: request.webhookSecret,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

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
    },
  };
}
