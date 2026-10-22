import type { ProviderAdapter } from "@paymentchaos/core";
import { createStripeAdapter } from "@paymentchaos/provider-stripe";

export async function loadStripeAdapter(env?: NodeJS.ProcessEnv): Promise<ProviderAdapter> {
  return createStripeAdapter({ env: env ?? process.env });
}
