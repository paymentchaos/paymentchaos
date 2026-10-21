import * as z from "zod";

/**
 * Assertion contracts. HTTP responses do not prove business correctness, so the real
 * verdict comes from the developer's application state. See ADR 0005.
 */

/** Re-run the assertion until it passes or the timeout elapses (async processing). */
export const settleSchema = z.strictObject({
  timeoutMs: z.int().min(0),
  intervalMs: z.int().min(1),
});

/** A JSON endpoint check: GET the URL and match JSONPath expectations. (v0.1) */
export const httpAssertSchema = z.strictObject({
  url: z.url(),
  /** Map of JSONPath expression to expected value. */
  expect: z.record(z.string(), z.unknown()),
});

/** How a scenario verifies final application state. */
export const assertSchema = z.strictObject({
  settle: settleSchema.optional(),
  /** Shell command run after the scenario. Exit 0 passes, non-zero fails. (M1) */
  command: z.string().min(1).optional(),
  http: httpAssertSchema.optional(),
});

/**
 * The optional JSON document a command assertion may print to stdout for rich
 * reporting. The command's exit code remains the source of truth for pass/fail.
 */
export const commandResultSchema = z.strictObject({
  checks: z.array(
    z.strictObject({
      name: z.string().min(1),
      pass: z.boolean(),
      expected: z.unknown().optional(),
      observed: z.unknown().optional(),
      message: z.string().optional(),
    }),
  ),
});

export type SettleConfig = z.infer<typeof settleSchema>;
export type HttpAssert = z.infer<typeof httpAssertSchema>;
export type AssertConfig = z.infer<typeof assertSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
