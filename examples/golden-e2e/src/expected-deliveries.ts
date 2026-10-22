import { compilePlan, type ProviderAdapter, type Scenario } from "@paymentchaos/core";

export function countDeliveriesForEvent(
  adapter: ProviderAdapter,
  scenario: Scenario,
  seed: number,
  eventType: string,
): number {
  const compiled = compilePlan({ ...scenario, seed }, adapter, { seed });
  return compiled.plan.deliveries.filter((row) => row.event.type === eventType).length;
}

export function compiledIds(
  adapter: ProviderAdapter,
  scenario: Scenario,
  seed: number,
): Readonly<Record<string, string>> {
  return compilePlan({ ...scenario, seed }, adapter, { seed }).ids;
}
