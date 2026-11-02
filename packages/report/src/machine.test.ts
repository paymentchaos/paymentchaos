import { type RunReport, runReportSchema } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { renderJsonReport } from "./json.ts";
import { renderJunitReport } from "./junit.ts";

// Fixed timestamps and latencies keep machine-format snapshots independent of wall time.
const report: RunReport = {
  schemaVersion: 1,
  runId: "run_demo",
  seed: -1337,
  planHash: "a1234567",
  provider: "stripe",
  scenario: "更新 & renewal",
  startedAt: "2026-01-15T12:00:00.000Z",
  finishedAt: "2026-01-15T12:00:01.234Z",
  repeat: 20,
  repeatsFailed: 2,
  status: "failed",
  deliveries: [
    {
      seq: 0,
      attempt: 2,
      eventType: "invoice.paid",
      eventId: "evt_demo",
      latencyMs: 10,
      statusCode: 200,
      chaosTags: ["duplicate", "concurrent"],
    },
  ],
  assertions: [
    { name: "signature", pass: true },
    {
      name: 'balance < "expected"',
      pass: false,
      message: "重复 & duplicate",
      expected: { JPY: 100, INR: 10000, BHD: 100000 },
      observed: null,
    },
  ],
};

describe("machine reporters", () => {
  it("preserves the complete frozen JSON schema and Unicode values", () => {
    const text = renderJsonReport(report);
    expect(runReportSchema.parse(JSON.parse(text))).toEqual(report);
    expect(text).toMatchSnapshot();
    expect(JSON.parse(renderJsonReport([report, report]))).toEqual([report, report]);
  });

  it("renders one suite per scenario with accurate assertion counts and metadata", () => {
    const passed: RunReport = {
      ...report,
      status: "passed",
      repeat: 1,
      repeatsFailed: 0,
      assertions: [{ name: "signature", pass: true }],
    };
    const text = renderJunitReport([report, passed]);
    expect(text).toContain(
      '<testsuites tests="3" failures="1" errors="0" skipped="0" time="2.468">',
    );
    expect(text).toMatchSnapshot();
    expect(report.assertions).toHaveLength(2);
  });

  it.each(["passed", "failed", "error"] as const)(
    "represents %s even without assertions",
    (status) => {
      const text = renderJunitReport([{ ...report, assertions: [], status }]);
      expect(text).toContain(
        `tests="1" failures="${Number(status === "failed")}" errors="${Number(status === "error")}"`,
      );
      expect(text).toContain("PaymentChaos run status");
    },
  );

  it("counts errors separately from failing assertions", () => {
    const text = renderJunitReport([{ ...report, status: "error" }]);
    expect(text).toContain('tests="3" failures="1" errors="1"');
    expect(text).toContain('<error message="error">error</error>');
  });

  it("escapes XML injection, whitespace and forbidden characters without damaging emoji", () => {
    const text = renderJunitReport([
      {
        ...report,
        scenario: "🙂\u0000\ud800\ufffe\t\n\r",
        assertions: [{ name: "'\"&<>\t\n\r", pass: false, message: "</failure><testcase/>]]>" }],
      },
    ]);
    expect(text).toContain('name="🙂���&#9;&#10;&#13;"');
    expect(text).toContain('name="&apos;&quot;&amp;&lt;&gt;&#9;&#10;&#13;"');
    expect(text).toContain("&lt;/failure&gt;&lt;testcase/&gt;]]&gt;");
    expect(text).not.toContain("\u0000");
    expect(text).not.toContain("<!DOCTYPE");
  });
});
