import { type ChaosOperator, PaymentChaosError, type Rng } from "../contracts/index.ts";
import { messages } from "../messages.ts";
import { normalizeDraft, type PlanDraft } from "../plan/draft.ts";
import { concurrent, delay, duplicate, reorder } from "./builtins.ts";
import type { ChaosOperatorDefinition } from "./definition.ts";

/** Operators by scenario key. Params are validated by the scenario schema beforehand. */
export type OperatorRegistry = ReadonlyMap<string, ChaosOperatorDefinition<never>>;

export const defaultOperatorRegistry: OperatorRegistry = new Map<
  string,
  ChaosOperatorDefinition<never>
>([
  [duplicate.name, duplicate],
  [reorder.name, reorder],
  [delay.name, delay],
  [concurrent.name, concurrent],
]);

/** The single key of a scenario chaos entry, e.g. `{ duplicate: {...} }` → `"duplicate"`. */
export function operatorName(op: ChaosOperator): string {
  const [name] = Object.keys(op);
  return name ?? "";
}

/**
 * Apply chaos operators in declared order (ADR 0004: order is significant). Operator
 * `i` gets its own RNG stream `chaos:<i>:<name>`, so adding an operator never perturbs
 * the randomness of the ones before it.
 */
export function applyChaos(
  draft: PlanDraft,
  chaos: readonly ChaosOperator[],
  rng: Rng,
  registry: OperatorRegistry = defaultOperatorRegistry,
): PlanDraft {
  let plan = normalizeDraft(draft);
  chaos.forEach((op, i) => {
    const name = operatorName(op);
    const definition = registry.get(name) as ChaosOperatorDefinition<unknown> | undefined;
    if (definition === undefined) {
      throw new PaymentChaosError(
        "CONFIG_INVALID",
        messages.chaosOperatorUnknown(name, [...registry.keys()]),
        {
          details: { operator: name, index: i },
        },
      );
    }
    const params = (op as Record<string, unknown>)[name];
    plan = normalizeDraft(definition.apply(plan, rng.fork(`chaos:${String(i)}:${name}`), params));
  });
  return plan;
}
