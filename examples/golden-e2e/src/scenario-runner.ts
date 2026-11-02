/**
 * Runner boundary for golden end-to-end tests. Uses the built CLI when
 * `GOLDEN_E2E_RUNNER=cli`, otherwise executes `@paymentchaos/core` with the Stripe adapter.
 */
export interface StripeSubscriptionRenewalIds {
  readonly customer: string;
  readonly stripeCustomer: string;
  readonly subscription: string;
}

export interface StripeSubscriptionRenewalRequest {
  readonly targetWebhookUrl: string;
  readonly webhookSecret: string;
  readonly ids?: StripeSubscriptionRenewalIds;
  readonly seed: number;
}

export interface StripeSubscriptionRenewalResult {
  readonly deliveries: ReadonlyArray<{
    eventType: string;
    eventId: string;
    statusCode: number;
  }>;
  readonly ids: Readonly<Record<string, string>>;
  readonly stdout: string;
  readonly exitCode: number;
}

export interface ScenarioRunner {
  runStripeSubscriptionRenewal(
    request: StripeSubscriptionRenewalRequest,
  ): Promise<StripeSubscriptionRenewalResult>;
}

export type ScenarioRunnerFactory = () => ScenarioRunner;

let factory: ScenarioRunnerFactory | null = null;

export function registerScenarioRunner(next: ScenarioRunnerFactory): void {
  factory = next;
}

export function createScenarioRunner(): ScenarioRunner {
  if (!factory) {
    throw new Error(
      "No scenario runner registered. golden-e2e registers a runner in test/setup.ts.",
    );
  }
  return factory();
}
