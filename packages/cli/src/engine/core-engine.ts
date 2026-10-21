import { compilePlan, PaymentChaosError, type RunOutcome, runScenario } from "@paymentchaos/core";
import { messages } from "../messages.ts";
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
      if (options.repeatIndex !== undefined) {
        throw new PaymentChaosError("CONFIG_INVALID", messages.repeatIndexUnsupported);
      }

      const adapter = registry.getAdapter(options.scenario.provider);
      const runOptions = {
        adapter,
        cwd: options.cwd,
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.repeat !== undefined ? { repeat: options.repeat } : {}),
        ...(options.stableIds === true ? { stableIds: true } : {}),
        ...(options.allowRemoteTarget === undefined
          ? {}
          : { allowRemoteTarget: options.allowRemoteTarget }),
        ...(options.env === undefined ? {} : { env: options.env }),
      };

      const outcome = await runScenario(options.scenario, runOptions);
      const failedIndex = failedRepeatIndex(outcome);
      return {
        report: outcome.report,
        notes: outcome.notes,
        ...(failedIndex === undefined ? {} : { failedRepeatIndex: failedIndex }),
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
