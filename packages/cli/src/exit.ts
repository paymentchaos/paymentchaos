import { ExitCode, exitCodeFor, type RunReport } from "@paymentchaos/core";

export function exitCodeForReport(report: RunReport): ExitCode {
  if (report.status === "passed") {
    return ExitCode.Ok;
  }
  if (report.status === "failed") {
    return ExitCode.AssertionFailed;
  }
  return ExitCode.Internal;
}

export { ExitCode, exitCodeFor };
