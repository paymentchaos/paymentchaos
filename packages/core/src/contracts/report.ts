import * as z from "zod";

/**
 * The machine-readable run report (schema version 1). This is the shape written to the
 * JSON reporter and the basis for JUnit/HTML. Timestamps are UTC ISO 8601 strings; see
 * ADR 0007. The committed `schemas/report.v1.json` is generated from this schema.
 */

export const runStatusSchema = z.enum(["passed", "failed", "error"]);

export const deliveryResultSchema = z.strictObject({
  seq: z.int(),
  attempt: z.int(),
  eventType: z.string(),
  eventId: z.string(),
  statusCode: z.int().optional(),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
  chaosTags: z.array(z.string()),
});

export const assertionResultSchema = z.strictObject({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown().optional(),
  observed: z.unknown().optional(),
  message: z.string().optional(),
});

export const runReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string(),
  seed: z.int(),
  planHash: z.string(),
  provider: z.string(),
  scenario: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  repeat: z.int().min(1),
  repeatsFailed: z.int().min(0),
  status: runStatusSchema,
  deliveries: z.array(deliveryResultSchema),
  assertions: z.array(assertionResultSchema),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type DeliveryResult = z.infer<typeof deliveryResultSchema>;
export type AssertionResult = z.infer<typeof assertionResultSchema>;
export type RunReport = z.infer<typeof runReportSchema>;
