import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExitCode, runReportSchema } from "@paymentchaos/core";
import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import { CiDemoError } from "./ci-demo-error.js";
import { messages } from "./ci-demo-messages.js";
import { runCliReport } from "./cli-scenario-runner.js";

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

/** Accepts exactly `--out <absolute dir>`, optionally after the `--` that some pnpm versions forward. */
export function parseCiDemoArgv(argv: readonly string[]): { outDir: string } {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const [flag, value, extra] = args;
  if (flag === undefined) {
    throw new CiDemoError("USAGE", messages.missingOut);
  }
  if (flag !== "--out") {
    throw new CiDemoError("USAGE", messages.unexpectedArgument(flag));
  }
  if (value === undefined) {
    throw new CiDemoError("USAGE", messages.missingOut);
  }
  if (extra !== undefined) {
    throw new CiDemoError("USAGE", messages.unexpectedArgument(extra));
  }
  if (!isAbsolute(value)) {
    throw new CiDemoError("USAGE", messages.outNotAbsolute(value));
  }
  return { outDir: resolve(value) };
}

function reportError(message: string): CiDemoError {
  return new CiDemoError("REPORT_INVALID", message);
}

function validateJsonReport(options: {
  path: string;
  stdout: string;
  label: string;
  expectStatus: "passed" | "failed";
}): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(options.stdout);
  } catch (error) {
    throw reportError(messages.jsonInvalid(options.path, (error as Error).message));
  }
  const report = runReportSchema.safeParse(parsed);
  if (!report.success) {
    const issue = report.error.issues[0];
    const detail = issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid";
    throw reportError(messages.jsonInvalid(options.path, detail));
  }
  if (report.data.status !== options.expectStatus) {
    throw reportError(messages.jsonStatus(options.label, options.expectStatus, report.data.status));
  }
  if (options.expectStatus === "failed" && !options.stdout.includes(NAIVE_FAILURE_SNIPPET)) {
    throw reportError(messages.naiveMessageMissing);
  }
}

function validateJUnitReport(options: {
  path: string;
  stdout: string;
  label: string;
  expectFailure: boolean;
}): void {
  const text = options.stdout;
  const root = text.match(/<testsuites tests="(\d+)" failures="(\d+)" errors="(\d+)"/);
  if (!text.startsWith("<?xml") || !/<\/testsuites>\n?$/.test(text) || !root) {
    throw reportError(messages.junitMalformed(options.path));
  }
  const tests = Number(root[1]);
  const failures = Number(root[2]);
  const errors = Number(root[3]);
  if (tests < 1) {
    throw reportError(messages.junitEmpty(options.label));
  }
  if (options.expectFailure) {
    if (failures + errors < 1) {
      throw reportError(messages.junitVerdict(options.label, "fail"));
    }
    if (!text.includes(NAIVE_FAILURE_SNIPPET)) {
      throw reportError(messages.naiveMessageMissing);
    }
  } else if (failures !== 0 || errors !== 0) {
    throw reportError(messages.junitVerdict(options.label, "pass"));
  }
}

async function runOneReport(options: {
  label: "naive" | "correct";
  reporter: "json" | "junit";
  outPath: string;
}): Promise<void> {
  const exampleName = options.label === "naive" ? "stripe-express-naive" : "stripe-express-correct";
  const start = options.label === "naive" ? startNaiveExample : startCorrectExample;
  const expectedExit = options.label === "naive" ? ExitCode.AssertionFailed : ExitCode.Ok;
  const tag = `${exampleName} (${options.reporter})`;
  // A fresh app (and SQLite database) per run, so the JUnit run never sees JSON-run state.
  const app = await start();
  try {
    // runCliReport rejects output containing the secret before stderr reaches any message.
    const result = await runCliReport(
      { exampleDir: join(examplesRoot, exampleName) },
      {
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        seed,
      },
      { label: tag, reporter: options.reporter, outPath: options.outPath, timeoutMs: runTimeoutMs },
    );
    const diagnostic = messages.stderrDiagnostic(result.stderr);
    if (result.exitCode !== ExitCode.Ok && result.exitCode !== ExitCode.AssertionFailed) {
      throw new CiDemoError("CLI_EXIT", messages.internalError(tag, result.exitCode) + diagnostic);
    }
    if (result.exitCode !== expectedExit) {
      throw new CiDemoError(
        "CLI_EXIT",
        messages.unexpectedExit(tag, expectedExit, result.exitCode) + diagnostic,
      );
    }
    if (!existsSync(options.outPath)) {
      throw reportError(messages.missingArtifact(options.outPath));
    }
    if ((await readFile(options.outPath, "utf8")) !== result.stdout) {
      throw reportError(messages.stdoutMismatch(options.outPath));
    }
    if (options.reporter === "json") {
      validateJsonReport({
        path: options.outPath,
        stdout: result.stdout,
        label: tag,
        expectStatus: options.label === "naive" ? "failed" : "passed",
      });
    } else {
      validateJUnitReport({
        path: options.outPath,
        stdout: result.stdout,
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
    throw new CiDemoError("BUILD_MISSING", messages.missingBuild);
  }
  const info = await stat(outDir).catch(() => undefined);
  if (info === undefined) {
    await mkdir(outDir, { recursive: true });
  } else if (!info.isDirectory()) {
    throw new CiDemoError("OUTPUT_INVALID", messages.outputNotDirectory(outDir));
  } else if ((await readdir(outDir)).length > 0) {
    throw new CiDemoError("OUTPUT_INVALID", messages.outputNotEmpty(outDir));
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
