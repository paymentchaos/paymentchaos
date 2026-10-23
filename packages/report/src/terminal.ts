import type { AssertionResult, RunReport } from "@paymentchaos/core";
import pc from "picocolors";
import { formatValue, shortPlanHash } from "./format.ts";
import { messages } from "./messages.ts";
import { quoteShellArg } from "./shell-quote.ts";

/** Display cap for assertion names in the terminal, ellipsis included. */
const MAX_ASSERTION_NAME_LENGTH = 80;

export interface TerminalRenderOptions {
  /** Scenario file path or built-in name used in the reproduce command. */
  readonly scenarioRef: string;
  /** Original `--repeat` / scenario repeat (for reproduce when one index was selected). */
  readonly scenarioRepeat?: number;
  /** 1-based index of the failed repeat, when `report.repeat` > 1. */
  readonly failedRepeatIndex?: number;
  /** When true, only one repetition was executed (--repeat-index). */
  readonly repeatSelection?: boolean;
  /** Caveats from {@link RunOutcome.notes} (core run surface). */
  readonly notes?: readonly string[];
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

/** Repeat count of the original run: the scenario's `repeat`, even when one index was selected. */
function effectiveRepeatTotal(report: RunReport, options: TerminalRenderOptions): number {
  return options.scenarioRepeat ?? report.repeat;
}

function buildReproduceCommand(
  scenarioRef: string,
  seed: number,
  repeatTotal: number,
  failedRepeatIndex: number | undefined,
): string {
  const parts = ["npx", "paymentchaos", "run", quoteShellArg(scenarioRef), "--seed", String(seed)];
  if (repeatTotal > 1) {
    parts.push("--repeat", String(repeatTotal));
    if (failedRepeatIndex !== undefined && failedRepeatIndex > 0) {
      parts.push("--repeat-index", String(failedRepeatIndex));
    }
  }
  return parts.join(" ");
}

/**
 * Shorten an assertion name for the terminal only. Check names come from the user's assertion
 * command and can run to hundreds of characters; JSON reports keep them whole.
 * Slices by code point so a non-ASCII name is never split mid-character.
 */
export function truncateAssertionName(name: string, maxLength = MAX_ASSERTION_NAME_LENGTH): string {
  const chars = Array.from(name);
  if (chars.length <= maxLength) {
    return name;
  }
  return `${chars.slice(0, maxLength - 1).join("")}${messages.ellipsis}`;
}

function renderAssertion(assertion: AssertionResult, useColor: boolean): string[] {
  const name = truncateAssertionName(assertion.name);
  if (assertion.pass) {
    const mark = messages.assertionPass(name);
    return [useColor ? pc.green(mark) : mark];
  }

  const mark = messages.assertionFail(assertion.message?.trim() ? assertion.message : name);
  const lines = [useColor ? pc.red(mark) : mark];
  if (assertion.expected !== undefined) {
    lines.push(messages.expected(formatValue(assertion.expected)));
  }
  if (assertion.observed !== undefined) {
    lines.push(messages.observed(formatValue(assertion.observed)));
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
    out.push(...renderAssertion(assertion, useColor));
  }

  const repeatTotal = effectiveRepeatTotal(report, options);
  if (report.status === "failed" || report.status === "error") {
    out.push("");
    out.push(
      messages.reproduce(
        buildReproduceCommand(
          options.scenarioRef,
          report.seed,
          repeatTotal,
          options.failedRepeatIndex,
        ),
      ),
    );
  }

  if (options.notes !== undefined && options.notes.length > 0) {
    out.push("");
    out.push(messages.notesHeading);
    for (const note of options.notes) {
      out.push(messages.noteLine(note));
    }
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
  // A single-repetition run has no repeat to point at, so the suffix would only say "1/1".
  if (repeatTotal > 1 && report.repeatsFailed > 0) {
    if (options.failedRepeatIndex === undefined) {
      bannerParts.push(messages.repeatsFailedSummary(report.repeatsFailed, report.repeat));
    } else if (options.repeatSelection === true) {
      bannerParts.push(messages.repeatSelectedFailed(options.failedRepeatIndex, repeatTotal));
    } else {
      bannerParts.push(messages.repeatFailed(options.failedRepeatIndex, repeatTotal));
    }
  }
  out.push(bannerParts.join("  "));

  return `${out.join("\n")}\n`;
}
