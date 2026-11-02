import type { RunReport } from "@paymentchaos/core";
import { formatValue } from "./format.ts";
import { messages } from "./messages.ts";

function xml(value: string): string {
  // XML 1.0 forbids controls and lone surrogates even as numeric character references.
  return value
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "�")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
}

/** One suite per completed scenario; assertions describe the repetition selected by core. */
export function renderJunitReport(reports: readonly RunReport[]): string {
  let tests = 0;
  let failures = 0;
  let errors = 0;
  let time = 0;
  const suites = reports.map((report, index) => {
    const checks = [...report.assertions];
    // Do not turn a failed/error run with no failing assertion into green CI output.
    const runError = report.status === "error";
    if (
      runError ||
      checks.length === 0 ||
      (report.status === "failed" && checks.every((c) => c.pass))
    ) {
      checks.push({
        name: messages.junitRunStatus,
        pass: report.status === "passed",
        message: report.status,
      });
    }
    const failed = checks.filter((c) => !c.pass).length - Number(runError);
    const duration = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;
    const seconds = Number.isFinite(duration) ? Math.max(0, duration) : 0;
    tests += checks.length;
    failures += failed;
    errors += Number(runError);
    time += seconds;
    const properties = [
      "runId",
      "seed",
      "planHash",
      "provider",
      "status",
      "repeat",
      "repeatsFailed",
    ] as const;
    const cases = checks.map((check, i) => {
      const open = `    <testcase name="${xml(check.name)}" classname="${xml(`${report.provider}.${report.scenario}`)}">`;
      if (check.pass) return `${open}</testcase>`;
      const tag = runError && i === checks.length - 1 ? "error" : "failure";
      const detail = [
        check.message,
        ...(check.expected !== undefined ? [messages.expected(formatValue(check.expected))] : []),
        ...(check.observed !== undefined ? [messages.observed(formatValue(check.observed))] : []),
      ]
        .filter((line) => line !== undefined)
        .join("\n");
      return `${open}<${tag} message="${xml(check.message ?? check.name)}">${xml(detail)}</${tag}></testcase>`;
    });
    return [
      `  <testsuite id="${index}" name="${xml(report.scenario)}" tests="${checks.length}" failures="${failed}" errors="${Number(runError)}" skipped="0" time="${seconds}" timestamp="${xml(report.startedAt)}">`,
      "    <properties>",
      ...properties.map(
        (key) => `      <property name="${key}" value="${xml(String(report[key]))}"/>`,
      ),
      "    </properties>",
      ...cases,
      "  </testsuite>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${tests}" failures="${failures}" errors="${errors}" skipped="0" time="${time}">`,
    ...suites,
    "</testsuites>\n",
  ].join("\n");
}
