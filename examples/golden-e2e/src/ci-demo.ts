import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExitCode, runReportSchema } from "@paymentchaos/core";
import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import { messages } from "./ci-demo-messages.js";
import { createCliScenarioRunner } from "./cli-scenario-runner.js";

const goldenRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = join(goldenRoot, "..");
const repoRoot = join(goldenRoot, "..", "..");
const seed = 1337;
const runTimeoutMs = 90_000;

export const ciDemoReportNames = {
  naiveJson: "stripe-express-naive.json",
  naiveJUnit: "stripe-express-naive.junit.xml",
  correctJson: "stripe-express-correct.json",
  correctJUnit: "stripe-express-correct.junit.xml",
} as const;

const NAIVE_FAILURE_SNIPPET = "Duplicate invoice.paid delivery created 5 renewal ledger entries.";

function cliBuilt(): boolean {
  return existsSync(join(repoRoot, "packages", "cli", "dist", "bin.js"));
}

export function parseCiDemoArgv(argv: string[]): { outDir: string } {
  const outIndex = argv.indexOf("--out");
  if (outIndex === -1 || argv[outIndex + 1] === undefined) {
    throw new Error(messages.missingOut);
  }
  const trailing = argv.slice(outIndex + 2);
  if (trailing.some((arg) => arg.startsWith("-"))) {
    throw new Error(messages.usage);
  }
  const rawOut = argv[outIndex + 1] ?? "";
  if (!isAbsolute(rawOut)) {
    throw new Error(messages.usage);
  }
  return { outDir: resolve(rawOut) };
}

function assertNoSecret(text: string, secret: string, label: string): void {
  if (secret.length > 0 && text.includes(secret)) {
    throw new Error(messages.secretInOutput(label));
  }
}

function rejectInternalExit(label: string, code: number): void {
  if (code !== ExitCode.Ok && code !== ExitCode.AssertionFailed) {
    throw new Error(messages.internalError(label, code));
  }
}

async function validateJsonReport(options: {
  path: string;
  stdout: string;
  secret: string;
  label: string;
  expectStatus: "passed" | "failed";
}): Promise<void> {
  const disk = await readFile(options.path, "utf8");
  if (disk !== options.stdout) {
    throw new Error(messages.stdoutMismatch(options.path));
  }
  assertNoSecret(options.stdout, options.secret, options.label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(options.stdout);
  } catch {
    throw new Error(messages.jsonInvalid(options.path));
  }
  const report = runReportSchema.parse(parsed);
  if (report.status !== options.expectStatus) {
    throw new Error(messages.jsonStatus(options.label, options.expectStatus, report.status));
  }
  if (options.expectStatus === "failed") {
    if (!options.stdout.includes(NAIVE_FAILURE_SNIPPET)) {
      throw new Error(messages.naiveMessageMissing);
    }
  } else if (report.status !== "passed") {
    throw new Error(messages.correctNotPassed);
  }
}

async function validateJUnitReport(options: {
  path: string;
  stdout: string;
  secret: string;
  label: string;
  expectFailure: boolean;
}): Promise<void> {
  const disk = await readFile(options.path, "utf8");
  if (disk !== options.stdout) {
    throw new Error(messages.stdoutMismatch(options.path));
  }
  assertNoSecret(options.stdout, options.secret, options.label);
  const text = options.stdout;
  if (!text.startsWith("<?xml") || !/<\/testsuites>\n?$/.test(text)) {
    throw new Error(messages.junitMalformed(options.path));
  }
  const root = text.match(/<testsuites tests="(\d+)" failures="(\d+)" errors="(\d+)"/);
  if (!root) {
    throw new Error(messages.junitVerdict(options.label, options.expectFailure ? "fail" : "pass"));
  }
  const failures = Number(root[2]);
  const errors = Number(root[3]);
  if (options.expectFailure) {
    if (failures + errors < 1) {
      throw new Error(messages.junitVerdict(options.label, "fail"));
    }
    if (!text.includes(NAIVE_FAILURE_SNIPPET)) {
      throw new Error(messages.naiveMessageMissing);
    }
  } else if (failures !== 0 || errors !== 0) {
    throw new Error(messages.junitVerdict(options.label, "pass"));
  }
}

async function runOneReport(options: {
  label: "naive" | "correct";
  reporter: "json" | "junit";
  outPath: string;
}): Promise<void> {
  const exampleDir = join(
    examplesRoot,
    options.label === "naive" ? "stripe-express-naive" : "stripe-express-correct",
  );
  const start = options.label === "naive" ? startNaiveExample : startCorrectExample;
  const humanLabel = options.label === "naive" ? "stripe-express-naive" : "stripe-express-correct";
  const expectedExit = options.label === "naive" ? ExitCode.AssertionFailed : ExitCode.Ok;
  const app = await start();
  try {
    const runner = createCliScenarioRunner({ exampleDir });
    const result = await runner.runStripeSubscriptionRenewal(
      {
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        seed,
      },
      { reporter: options.reporter, outPath: options.outPath, timeoutMs: runTimeoutMs },
    );
    const tag = `${humanLabel} (${options.reporter})`;
    rejectInternalExit(tag, result.exitCode);
    if (result.exitCode !== expectedExit) {
      throw new Error(messages.unexpectedExit(tag, expectedExit, result.exitCode));
    }
    if (!existsSync(options.outPath)) {
      throw new Error(messages.missingArtifact(options.outPath));
    }
    if (options.reporter === "json") {
      await validateJsonReport({
        path: options.outPath,
        stdout: result.stdout,
        secret: app.webhookSecret,
        label: tag,
        expectStatus: options.label === "naive" ? "failed" : "passed",
      });
    } else {
      await validateJUnitReport({
        path: options.outPath,
        stdout: result.stdout,
        secret: app.webhookSecret,
        label: tag,
        expectFailure: options.label === "naive",
      });
    }
  } finally {
    await app.close();
  }
}

async function runVariant(options: { label: "naive" | "correct"; outDir: string }): Promise<void> {
  const jsonOut = join(
    options.outDir,
    options.label === "naive" ? ciDemoReportNames.naiveJson : ciDemoReportNames.correctJson,
  );
  const junitOut = join(
    options.outDir,
    options.label === "naive" ? ciDemoReportNames.naiveJUnit : ciDemoReportNames.correctJUnit,
  );
  await runOneReport({ label: options.label, reporter: "json", outPath: jsonOut });
  await runOneReport({ label: options.label, reporter: "junit", outPath: junitOut });
}

export async function runCiDemo(outDir: string): Promise<void> {
  if (!cliBuilt()) {
    throw new Error(messages.missingBuild);
  }
  await mkdir(outDir, { recursive: true });
  const info = await stat(outDir);
  if (!info.isDirectory()) {
    throw new Error(messages.outputNotDirectory(outDir));
  }

  await runVariant({ label: "naive", outDir });
  await runVariant({ label: "correct", outDir });
}

async function main(): Promise<void> {
  const { outDir } = parseCiDemoArgv(process.argv.slice(2));
  await runCiDemo(outDir);
  process.stdout.write(`${messages.finished(outDir)}\n`);
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
  main().catch((error: unknown) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.stderr.write("\n");
    process.exit(1);
  });
}
