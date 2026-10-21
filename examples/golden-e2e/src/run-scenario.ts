import { asSecretRef, runScenario, type Scenario } from "@paymentchaos/core";
import { loadStripeAdapter } from "./load-adapter.js";

export interface RunGoldenScenarioOptions {
  readonly scenario: Scenario;
  readonly seed: number;
  readonly targetWebhookUrl: string;
  readonly webhookSecret: string;
}

export interface RunGoldenScenarioResult {
  readonly exitCode: number;
  readonly ids: Readonly<Record<string, string>>;
  readonly deliveries: ReadonlyArray<{
    eventType: string;
    eventId: string;
    statusCode: number;
  }>;
}

export async function runGoldenScenario(
  options: RunGoldenScenarioOptions,
): Promise<RunGoldenScenarioResult> {
  const adapter = await loadStripeAdapter({
    ...process.env,
    STRIPE_WEBHOOK_SECRET: options.webhookSecret,
  });

  const scenario: Scenario = {
    ...options.scenario,
    seed: options.seed,
    target: {
      url: options.targetWebhookUrl,
      secret: asSecretRef("${STRIPE_WEBHOOK_SECRET}"),
    },
  };

  const outcome = await runScenario(scenario, {
    adapter,
    seed: options.seed,
    stableIds: true,
    env: { STRIPE_WEBHOOK_SECRET: options.webhookSecret },
    repeat: 1,
  });

  return {
    exitCode: outcome.report.status === "passed" ? 0 : 1,
    ids: outcome.repeats[0]?.ids ?? {},
    deliveries: outcome.report.deliveries.map((row) => ({
      eventType: row.eventType,
      eventId: row.eventId,
      statusCode: row.statusCode ?? 0,
    })),
  };
}
