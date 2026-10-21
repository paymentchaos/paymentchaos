declare module "@paymentchaos/provider-stripe" {
  import type { Env, ProviderAdapter } from "@paymentchaos/core";

  export function createStripeAdapter(options?: { readonly env?: Env }): ProviderAdapter;
}
