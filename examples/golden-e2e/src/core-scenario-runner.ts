import { STRIPE_SUBSCRIPTION_RENEWAL } from "./builtin-scenarios.js";
import { runGoldenScenario } from "./run-scenario.js";
import type {
  ScenarioRunner,
  StripeSubscriptionRenewalRequest,
  StripeSubscriptionRenewalResult,
} from "./scenario-runner.js";

export function createCoreScenarioRunner(): ScenarioRunner {
  return {
    async runStripeSubscriptionRenewal(
      request: StripeSubscriptionRenewalRequest,
    ): Promise<StripeSubscriptionRenewalResult> {
      const result = await runGoldenScenario({
        scenario: STRIPE_SUBSCRIPTION_RENEWAL,
        seed: request.seed,
        targetWebhookUrl: request.targetWebhookUrl,
        webhookSecret: request.webhookSecret,
      });
      return { ...result, stdout: "" };
    },
  };
}
