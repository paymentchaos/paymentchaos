import { PaymentChaosError, type ProjectConfig, type Scenario } from "@paymentchaos/core";
import { messages } from "../messages.ts";

/** Merge project config defaults into a scenario (scenario wins on conflict). */
export function mergeScenarioWithProject(
  scenario: Scenario,
  project: ProjectConfig | undefined,
): Scenario {
  const providerTarget = project?.providers?.[scenario.provider]?.target;
  const mergedTarget = scenario.target ?? providerTarget;

  if (mergedTarget === undefined) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.missingTarget(scenario.provider));
  }

  const hooks = scenario.hooks ?? project?.hooks;
  const assertConfig = scenario.assert ?? project?.assert;

  return {
    ...scenario,
    target: mergedTarget,
    ...(hooks !== undefined ? { hooks } : {}),
    ...(assertConfig !== undefined ? { assert: assertConfig } : {}),
  };
}
