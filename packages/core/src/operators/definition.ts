import { type ChaosOperator, PaymentChaosError, type Rng } from "../contracts/index.ts";
import { messages } from "../messages.ts";
import type { PlanDraft } from "../plan/draft.ts";

/** Operator names in the frozen scenario schema, e.g. `"duplicate"`. */
export type OperatorName = ChaosOperator extends infer O
  ? O extends unknown
    ? keyof O
    : never
  : never;

/** The params object a scenario gives operator `K`. */
export type OperatorParams<K extends OperatorName> = Extract<ChaosOperator, Record<K, unknown>>[K];

/**
 * A chaos operator: a pure `(plan, rng, params) => plan` transform. Operators must not
 * read the wall clock or the platform RNG, and must not mutate their input.
 */
export interface ChaosOperatorDefinition<P> {
  readonly name: string;
  /** The real-world failure this operator models, with its documentation source. */
  readonly models: string;
  apply(plan: PlanDraft, rng: Rng, params: P): PlanDraft;
}

/** Throw a CONFIG_INVALID error unless the plan delivers at least one `eventType`. */
export function requireEventType(plan: PlanDraft, operator: string, eventType: string): void {
  if (plan.deliveries.some((d) => d.event.type === eventType)) return;
  const available = [...new Set(plan.deliveries.map((d) => d.event.type))];
  throw new PaymentChaosError(
    "CONFIG_INVALID",
    messages.chaosEventMissing(operator, eventType, plan.flow, available),
    { details: { operator, eventType, flow: plan.flow } },
  );
}
