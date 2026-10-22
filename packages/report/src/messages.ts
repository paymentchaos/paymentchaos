/** User-facing terminal report strings (i18n-ready). */

export const messages = {
  deliveriesHeading: "Deliveries",
  assertionsHeading: "Assertions",
  passedBanner: "PAYMENTCHAOS PASSED",
  failedBanner: "PAYMENTCHAOS FAILED",
  deliveryLine: (parts: {
    seq: number;
    eventType: string;
    eventId: string;
    attempt: number;
    status: string;
    latency: string;
    chaos: string;
  }) =>
    `#${parts.seq}  ${parts.eventType}  ${parts.eventId}  attempt ${parts.attempt}  ${parts.status}  ${parts.latency}  ${parts.chaos}`,
  deliveryError: (seq: number, error: string) => `#${seq}  error  ${error}`,
  assertionPass: (name: string) => `✓ ${name}`,
  assertionFail: (name: string) => `✗ ${name}`,
  expected: (value: string) => `    expected: ${value}`,
  observed: (value: string) => `    observed: ${value}`,
  reproduce: (cmd: string) => `reproduce: ${cmd}`,
  ellipsis: "…",
  repeatFailed: (index: number, total: number) => `repeat ${index}/${total} failed`,
  repeatSelectedFailed: (index: number, total: number) =>
    `selected repeat ${index} of ${total} failed (1 executed)`,
  repeatsFailedSummary: (failed: number, executed: number) =>
    `repeats failed: ${String(failed)}/${String(executed)}`,
  seedPlan: (seed: number, planHash: string) => `seed=${seed}  plan=${planHash}`,
  statusNoResponse: "—",
  chaosNone: "—",
  notesHeading: "Notes",
  noteLine: (text: string) => `  ${text}`,
} as const;
