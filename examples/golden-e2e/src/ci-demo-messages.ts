export const messages = {
  usage: "Usage: pnpm --filter @paymentchaos/golden-e2e demo:ci --out /absolute/path/to/reports",
  missingBuild:
    "Build PaymentChaos first with pnpm build (packages/cli/dist/bin.js), then rerun demo:ci.",
  missingOut: "Missing required --out directory for CI demo reports.",
  outputNotDirectory: (path: string) => `Output path is not a directory: ${path}`,
  cliTimeout: (label: string) =>
    `paymentchaos run did not finish within the CI demo time limit (${label}).`,
  unexpectedExit: (label: string, expected: number, actual: number) =>
    `${label}: expected CLI exit ${expected}, observed ${actual}.`,
  missingArtifact: (path: string) => `Expected report file was not written: ${path}`,
  stdoutMismatch: (path: string) =>
    `CLI stdout did not match the report written to ${path}. Check exit code handling.`,
  secretInOutput: (label: string) =>
    `${label}: CLI output contained the example webhook secret (must be redacted or omitted).`,
  jsonInvalid: (path: string) => `Report JSON failed schema validation: ${path}`,
  jsonStatus: (label: string, expected: string, actual: string) =>
    `${label}: expected JSON status "${expected}", observed "${actual}".`,
  junitMalformed: (path: string) =>
    `JUnit report is missing XML prologue or closing testsuites: ${path}`,
  junitVerdict: (label: string, expected: "pass" | "fail") =>
    `${label}: JUnit report verdict did not match expected ${expected}.`,
  naiveMessageMissing:
    "Naive JSON/JUnit report did not include the duplicate renewal entitlement failure.",
  correctNotPassed: "Correct JSON/JUnit report did not indicate a passing run.",
  finished: (directory: string) =>
    `CI demo reports written to ${directory} (naive assertion failure, correct pass).`,
  internalError: (label: string, code: number) =>
    `${label}: CLI exited ${code} (config, unreachable target, or internal error — not an assertion result).`,
};
