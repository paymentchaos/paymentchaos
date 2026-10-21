import * as z from "zod";
import { assertSchema } from "./assert.ts";
import { SECRET_REF_PATTERN } from "./brand.ts";

/**
 * Scenario and project-config contracts (schema version 1). YAML and the programmatic
 * `defineScenario()` API both compile to this validated model. See ADR 0004.
 *
 * Chaos operators included here are the M1 set: duplicate, reorder, delay, concurrent.
 * Later operators are added as new members without breaking existing scenarios.
 */

const eventType = z.string().min(1);

/** Redeliver an event one or more extra times (provider retry of the same event). */
export const duplicateOp = z.strictObject({
  duplicate: z.strictObject({
    event: eventType,
    times: z.int().min(1).default(1),
  }),
});

/** Deliver the listed event types in the given (reordered) order. */
export const reorderOp = z.strictObject({
  reorder: z.array(eventType).min(2),
});

/** Hold an event back by a fixed logical delay before delivering it. */
export const delayOp = z.strictObject({
  delay: z.strictObject({
    event: eventType,
    byMs: z.int().min(0),
  }),
});

/** Release several deliveries of one event together, to expose races. */
export const concurrentOp = z.strictObject({
  concurrent: z.strictObject({
    event: eventType,
    deliveries: z.int().min(2),
  }),
});

export const chaosOperatorSchema = z.union([duplicateOp, reorderOp, delayOp, concurrentOp]);

const secretRefSchema = z.string().regex(SECRET_REF_PATTERN, {
  message: "secret must be an environment reference like ${STRIPE_WEBHOOK_SECRET}",
});

export const targetSchema = z.strictObject({
  url: z.url(),
  secret: secretRefSchema.optional(),
});

const hooksSchema = z.strictObject({
  beforeEach: z.string().min(1).optional(),
  afterEach: z.string().min(1).optional(),
});

/** Flow parameters. Known keys are typed; unknown keys pass through for forward-compat. */
const paramsSchema = z.looseObject({
  currency: z.string().length(3).optional(),
  country: z.string().length(2).optional(),
});

export const scenarioSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  apiVersion: z.string().min(1).optional(),
  flow: z.string().min(1),
  params: paramsSchema.optional(),
  target: targetSchema.optional(),
  hooks: hooksSchema.optional(),
  chaos: z.array(chaosOperatorSchema).default([]),
  assert: assertSchema.optional(),
  repeat: z.int().min(1).default(1),
  seed: z.int().optional(),
});

/** Root `paymentchaos.config.yaml`: project-local targets, hooks and default assertion. */
export const projectConfigSchema = z.strictObject({
  version: z.literal(1),
  providers: z.record(z.string(), z.strictObject({ target: targetSchema })).optional(),
  hooks: hooksSchema.optional(),
  assert: assertSchema.optional(),
});

export type ChaosOperator = z.infer<typeof chaosOperatorSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioInput = z.input<typeof scenarioSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
