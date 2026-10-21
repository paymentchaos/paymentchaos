/**
 * `@paymentchaos/core` public surface: the frozen contracts (M0) plus the M1 engine
 * built behind them. Export narrowly; internals stay internal.
 */
export * from "./contracts/index.ts";
export {
  type DeliveryOutcome,
  type ExecuteOptions,
  type ExecutionResult,
  executePlan,
} from "./executor/execute.ts";
export { messages } from "./messages.ts";
export type {
  ChaosOperatorDefinition,
  OperatorName,
  OperatorParams,
} from "./operators/definition.ts";
export {
  applyChaos,
  defaultOperatorRegistry,
  type OperatorRegistry,
  operatorName,
} from "./operators/registry.ts";
export {
  type CompiledPlan,
  type CompileOptions,
  compilePlan,
  DEFAULT_CURRENCY,
} from "./plan/compile.ts";
export { createDraft, normalizeDraft, type PlanDraft } from "./plan/draft.ts";
export { hashPlan, PLAN_FORMAT_VERSION, type PlanHashInput } from "./plan/hash.ts";
export { createLogicalClock, LOGICAL_EPOCH } from "./runtime/clock.ts";
export {
  createIdFactory,
  createRunNonce,
  type IdFactoryOptions,
  type IssuedId,
  type RecordingIdFactory,
  RUN_NONCE_LENGTH,
} from "./runtime/ids.ts";
export { createRng, PRNG_VERSION } from "./runtime/rng.ts";
export {
  type Env,
  REDACTED,
  redactSecrets,
  resolveSecret,
  secretValues,
} from "./safety/secrets.ts";
export {
  assertTargetAllowed,
  isLocalHost,
  type TargetGuardOptions,
} from "./safety/target-guard.ts";
