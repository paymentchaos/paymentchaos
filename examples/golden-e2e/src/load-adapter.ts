import type { ProviderAdapter } from "@paymentchaos/core";
import { createStripeAdapterShim } from "./stripe-adapter-shim.js";

/** Prefer the real provider export when the provider stream lands. */
export async function loadStripeAdapter(env?: NodeJS.ProcessEnv): Promise<ProviderAdapter> {
  try {
    const mod = (await import("@paymentchaos/provider-stripe")) as {
      createStripeAdapter?: (options?: { env?: NodeJS.ProcessEnv }) => ProviderAdapter;
    };
    if (typeof mod.createStripeAdapter === "function") {
      return mod.createStripeAdapter({ env: env ?? process.env });
    }
  } catch {
    // Package not built or adapter not exported yet.
  }
  return createStripeAdapterShim({ env: env ?? process.env });
}
