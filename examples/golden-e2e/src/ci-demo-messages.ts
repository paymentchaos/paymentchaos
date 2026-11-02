const usage =
  "Usage: pnpm --filter @paymentchaos/golden-e2e demo:ci --out /absolute/path/to/reports";
const stderrTailChars = 2000;

export const messages = {
  usage,
  missingBuild:
    "Build PaymentChaos first with pnpm build (packages/cli/dist/bin.js), then rerun demo:ci.",
  missingOut: `Missing required --out directory for CI demo reports. ${usage}`,
  unexpectedArgument: (arg: string) => `Unexpected argument "${arg}". ${usage}`,
  outNotAbsolute: (path: string) => `--out must be an absolute directory, got "${path}". ${usage}`,
  outputNotDirectory: (path: string) => `Output path is not a directory: ${path}`,
  outputNotEmpty: (path: string) =>
    `Output directory is not empty: ${path}. Choose a new or empty directory so stale reports are never uploaded; demo:ci does not delete existing files.`,
  cliTimeout: (label: string, timeoutMs: number) =>
    `${label}: paymentchaos run did not finish within ${timeoutMs} ms; its process tree was stopped. Check that the example app and assertion command respond.`,
  cliStartFailed: (label: string) =>
    `${label}: the paymentchaos CLI process could not be started or was terminated by a signal.`,
  stderrDiagnostic: (stderr: string) => {
    const trimmed = stderr.trim();
    if (trimmed.length === 0) return "";
    const tail = trimmed.length > stderrTailChars ? `…${trimmed.slice(-stderrTailChars)}` : trimmed;
    return `\nCLI stderr:\n${tail}`;
  },
  unexpectedExit: (label: string, expected: number, actual: number) =>
    `${label}: expected CLI exit ${expected}, observed ${actual}.`,
  internalError: (label: string, code: number) =>
    `${label}: CLI exited ${code} (config, unreachable target, or internal error — not an assertion result).`,
  missingArtifact: (path: string) => `Expected report file was not written: ${path}`,
  stdoutMismatch: (path: string) =>
    `CLI stdout did not match the report written to ${path}. Check exit code handling.`,
  secretInOutput: (label: string) =>
    `${label}: CLI output contained the example webhook secret (must be redacted or omitted).`,
  jsonInvalid: (path: string, detail: string) =>
    `Report JSON failed schema validation: ${path} (${detail})`,
  jsonStatus: (label: string, expected: string, actual: string) =>
    `${label}: expected JSON status "${expected}", observed "${actual}".`,
  junitMalformed: (path: string) =>
    `JUnit report is missing XML prologue, closing testsuites or a testsuites tests/failures/errors summary: ${path}`,
  junitEmpty: (label: string) => `${label}: JUnit report contains no test cases.`,
  junitVerdict: (label: string, expected: "pass" | "fail") =>
    `${label}: JUnit report verdict did not match expected ${expected}.`,
  naiveMessageMissing:
    "Naive JSON/JUnit report did not include the duplicate renewal entitlement failure.",
  finished: (directory: string) =>
    `CI demo reports written to ${directory} (naive assertion failure, correct pass).`,
};
