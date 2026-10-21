import type { RunReport } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { normalizeTerminalOutput } from "./normalize.ts";
import { renderTerminalReport } from "./terminal.ts";

const failureReport: RunReport = {
  schemaVersion: 1,
  runId: "run_demo",
  seed: 1337,
  planHash: "7f3a9c2b",
  provider: "stripe",
  scenario: "renewal survives duplicates and reordering",
  startedAt: "2026-01-15T12:00:00.000Z",
  finishedAt: "2026-01-15T12:00:01.234Z",
  repeat: 20,
  repeatsFailed: 1,
  status: "failed",
  deliveries: [
    {
      seq: 1,
      attempt: 1,
      eventType: "invoice.paid",
      eventId: "evt_demo_1",
      statusCode: 200,
      latencyMs: 45.2,
      chaosTags: ["duplicate"],
    },
    {
      seq: 2,
      attempt: 2,
      eventType: "invoice.paid",
      eventId: "evt_demo_2",
      statusCode: 200,
      latencyMs: 38,
      chaosTags: ["duplicate"],
    },
  ],
  assertions: [
    {
      name: "entitlements",
      pass: false,
      expected: 1,
      observed: 2,
      message: "Duplicate invoice.paid delivery created two entitlement records.",
    },
  ],
};

describe("renderTerminalReport", () => {
  it("matches the BUILD_PROMPT §13 failure snapshot (timings normalized)", () => {
    const text = renderTerminalReport(failureReport, {
      scenarioRef: "renewal.yaml",
      failedRepeatIndex: 4,
      color: false,
    });
    expect(normalizeTerminalOutput(text)).toMatchInlineSnapshot(`
      "Deliveries
      #1  invoice.paid  evt_demo_1  attempt 1  200  <LATENCY>  duplicate
      #2  invoice.paid  evt_demo_2  attempt 2  200  <LATENCY>  duplicate

      Assertions
      ✗ Duplicate invoice.paid delivery created two entitlement records.
          expected: 1
          observed: 2
          reproduce: npx paymentchaos run renewal.yaml --seed 1337 --repeat-index 4

      PAYMENTCHAOS FAILED  seed=1337  plan=7f3a…  repeat 4/20 failed
      "
    `);
  });
});
