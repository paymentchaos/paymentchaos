import type { AssertionResult, RunReport } from "@paymentchaos/core";
import pc from "picocolors";
import { formatValue, shortPlanHash } from "./format.ts";
import { messages } from "./messages.ts";

export interface TerminalRenderOptions {
  /** Scenario file path or built-in name used in the reproduce command. */
  readonly scenarioRef: string;
  /** 1-based index of the failed repeat, when `report.repeat` > 1. */
  readonly failedRepeatIndex?: number;
  readonly color?: boolean;
}

function formatLatency(latencyMs: number): string {
  if (Number.isInteger(latencyMs)) {
    return `${latencyMs}ms`;
  }
  return `${latencyMs.toFixed(1)}ms`;
}

function formatStatus(statusCode: number | undefined, error: string | undefined): string {
  if (error !== undefined) {
    return "ERR";
  }
  if (statusCode === undefined) {
    return messages.statusNoResponse;
  }
  return String(statusCode);
}

function formatChaosTags(tags: readonly string[]): string {
  if (tags.length === 0) {
    return messages.chaosNone;
  }
  return tags.join(",");
}

function buildReproduceCommand(
  scenarioRef: string,
  seed: number,
  failedRepeatIndex: number | undefined,
): string {
  const parts = ["npx", "paymentchaos", "run", scenarioRef, "--seed", String(seed)];
  if (failedRepeatIndex !== undefined && failedRepeatIndex > 0) {
    parts.push("--repeat-index", String(failedRepeatIndex));
  }
  return parts.join(" ");
}

function renderAssertion(
  assertion: AssertionResult,
  options: TerminalRenderOptions,
  report: RunReport,
  useColor: boolean,
): string[] {
  const lines: string[] = [];
  const label = assertion.message?.trim() ? assertion.message : assertion.name;
  const mark = assertion.pass
    ? useColor
      ? pc.green(messages.assertionPass(assertion.name))
      : messages.assertionPass(assertion.name)
    : useColor
      ? pc.red(messages.assertionFail(label))
      : messages.assertionFail(label);

  if (assertion.pass) {
    lines.push(mark);
    return lines;
  }

  lines.push(mark);
  if (assertion.expected !== undefined) {
    lines.push(messages.expected(formatValue(assertion.expected)));
  }
  if (assertion.observed !== undefined) {
    lines.push(messages.observed(formatValue(assertion.observed)));
  }
  if (report.status === "failed" || report.status === "error") {
    lines.push(
      messages.reproduce(
        buildReproduceCommand(options.scenarioRef, report.seed, options.failedRepeatIndex),
      ),
    );
  }
  return lines;
}

/**
 * Render a {@link RunReport} as the M1 terminal timeline plus assertion results.
 * See BUILD_PROMPT §13.
 */
export function renderTerminalReport(report: RunReport, options: TerminalRenderOptions): string {
  const useColor = options.color !== false && process.stdout.isTTY;
  const out: string[] = [];

  out.push(messages.deliveriesHeading);
  for (const delivery of report.deliveries) {
    if (delivery.error !== undefined && delivery.statusCode === undefined) {
      out.push(messages.deliveryError(delivery.seq, delivery.error));
      continue;
    }
    out.push(
      messages.deliveryLine({
        seq: delivery.seq,
        eventType: delivery.eventType,
        eventId: delivery.eventId,
        attempt: delivery.attempt,
        status: formatStatus(delivery.statusCode, delivery.error),
        latency: formatLatency(delivery.latencyMs),
        chaos: formatChaosTags(delivery.chaosTags),
      }),
    );
  }

  out.push("");
  out.push(messages.assertionsHeading);
  for (const assertion of report.assertions) {
    out.push(...renderAssertion(assertion, options, report, useColor));
  }

  out.push("");
  const bannerParts = [
    report.status === "passed"
      ? useColor
        ? pc.green(messages.passedBanner)
        : messages.passedBanner
      : useColor
        ? pc.red(messages.failedBanner)
        : messages.failedBanner,
    messages.seedPlan(report.seed, shortPlanHash(report.planHash)),
  ];
  if (report.repeatsFailed > 0 && options.failedRepeatIndex !== undefined) {
    bannerParts.push(messages.repeatFailed(options.failedRepeatIndex, report.repeat));
  } else if (report.repeatsFailed > 0) {
    bannerParts.push(`repeats failed: ${report.repeatsFailed}/${report.repeat}`);
  }
  out.push(bannerParts.join("  "));

  return `${out.join("\n")}\n`;
}
