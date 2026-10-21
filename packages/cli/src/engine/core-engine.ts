import {
  compilePlan,
  PaymentChaosError,
  type RunOutcome,
  type RunScenarioOptions,
  runScenario,
} from "@paymentchaos/core";
import { messages } from "../messages.ts";
import type { ProviderRegistry } from "./registry.ts";
import type {
  FlowListing,
  PaymentChaosEngine,
  PlanEngineOptions,
  RunEngineOptions,
  RunEngineResult,
} from "./types.ts";

/** Core PR adds this field; forward at runtime until types re-export it. */
type RunScenarioOptionsWithRepeatIndex = RunScenarioOptions & {
  readonly repeatIndex?: number;
};

function assertRepeatIndexInRange(repeatIndex: number | undefined, repeat: number): void {
  if (repeatIndex === undefined) {
    return;
  }
  if (repeatIndex < 1 || repeatIndex > repeat) {
    throw new PaymentChaosError(
      "CONFIG_INVALID",
      messages.repeatIndexOutOfRange(repeatIndex, repeat),
    );
  }
}

function failedRepeatIndex(outcome: RunOutcome): number | undefined {
  const first = outcome.repeats.find((repeat) => !repeat.pass);
  return first?.index;
}

/** Wires `@paymentchaos/core` compile and run surfaces to installed provider adapters. */
export function createCoreEngine(registry: ProviderRegistry): PaymentChaosEngine {
  return {
    async run(options: RunEngineOptions): Promise<RunEngineResult> {
      assertRepeatIndexInRange(options.repeatIndex, options.repeat);

      const adapter = registry.getAdapter(options.scenario.provider);
      const runOptions: RunScenarioOptionsWithRepeatIndex = {
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
      return {
        report: outcome.report,
        notes: outcome.notes,
        ...(failedIndex === undefined ? {} : { failedRepeatIndex: failedIndex }),
        ...(options.repeat > 1 ? { scenarioRepeat: options.repeat } : {}),
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
