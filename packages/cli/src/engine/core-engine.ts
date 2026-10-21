import {
  compilePlan,
  type RunOutcome,
  type RunScenarioOptions,
  runScenario,
} from "@paymentchaos/core";
import type { ProviderRegistry } from "./registry.ts";
import type {
  FlowListing,
  PaymentChaosEngine,
  PlanEngineOptions,
  RunEngineOptions,
  RunEngineResult,
} from "./types.ts";

function failedRepeatIndex(outcome: RunOutcome): number | undefined {
  const first = outcome.repeats.find((repeat) => !repeat.pass);
  return first?.index;
}

/** Wires `@paymentchaos/core` compile and run surfaces to installed provider adapters. */
export function createCoreEngine(registry: ProviderRegistry): PaymentChaosEngine {
  return {
    async run(options: RunEngineOptions): Promise<RunEngineResult> {
      const adapter = registry.getAdapter(options.scenario.provider);
      const runOptions: RunScenarioOptions = {
        adapter,
        cwd: options.cwd,
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        repeat: options.repeat,
        ...(options.repeatIndex !== undefined ? { repeatIndex: options.repeatIndex } : {}),
        ...(options.stableIds === true ? { stableIds: true } : {}),
        ...(options.allowRemoteTarget === undefined
          ? {}
          : { allowRemoteTarget: options.allowRemoteTarget }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.timeoutMillis === undefined ? {} : { timeoutMillis: options.timeoutMillis }),
      };

      const outcome = await runScenario(options.scenario, runOptions);
      const failedIndex = failedRepeatIndex(outcome);
      const scenarioRepeat =
        options.repeatIndex !== undefined || options.repeat > 1 ? options.repeat : undefined;
      return {
        report: outcome.report,
        notes: outcome.notes,
        ...(failedIndex === undefined ? {} : { failedRepeatIndex: failedIndex }),
        ...(scenarioRepeat === undefined ? {} : { scenarioRepeat }),
      };
    },

    async plan(
      options: PlanEngineOptions,
    ): Promise<Awaited<ReturnType<PaymentChaosEngine["plan"]>>> {
      const adapter = registry.getAdapter(options.scenario.provider);
      return compilePlan(options.scenario, adapter, { seed: options.seed }).plan;
    },

    listFlows(providerFilter?: string): readonly FlowListing[] {
      return registry.listFlows(providerFilter);
    },
  };
}
