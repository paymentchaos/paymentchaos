import type { RunReport } from "@paymentchaos/core";

/** One schema-v1 report, or an array of schema-v1 reports for a multi-scenario run. */
export function renderJsonReport(report: RunReport | readonly RunReport[]): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
