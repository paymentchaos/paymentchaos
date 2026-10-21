/**
 * Thin runner boundary for golden end-to-end tests.
 * Wire `createScenarioRunner()` to the real `paymentchaos run stripe-subscription-renewal`
 * CLI once the engine stream lands; keep tests importing this module only.
 */
export interface StripeSubscriptionRenewalIds {
  readonly customer: string;
  readonly stripeCustomer: string;
  readonly subscription: string;
}

export interface StripeSubscriptionRenewalRequest {
  readonly targetWebhookUrl: string;
  readonly webhookSecret: string;
  readonly ids: StripeSubscriptionRenewalIds;
  readonly seed: number;
}

export interface StripeSubscriptionRenewalResult {
  readonly deliveries: ReadonlyArray<{
    eventType: string;
    eventId: string;
    statusCode: number;
  }>;
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
      "No scenario runner registered. golden-e2e registers a stub in test/setup; wire paymentchaos CLI here when available.",
    );
  }
  return factory();
}
