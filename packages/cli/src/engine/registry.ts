import type { Env, ProviderAdapter } from "@paymentchaos/core";
import { PaymentChaosError } from "@paymentchaos/core";
import { createGenericAdapter } from "@paymentchaos/provider-generic";
import { createRazorpayAdapter } from "@paymentchaos/provider-razorpay";
import { createStripeAdapter } from "@paymentchaos/provider-stripe";
import { messages } from "../messages.ts";
import type { FlowListing } from "./types.ts";

export interface ProviderRegistry {
  getAdapter(providerId: string, params?: unknown): ProviderAdapter;
  listFlows(providerFilter?: string): readonly FlowListing[];
}

/** All supported providers ship as CLI dependencies. */
export async function createProviderRegistry(env: Env = process.env): Promise<ProviderRegistry> {
  const adapters = new Map<string, ProviderAdapter>(
    [
      createStripeAdapter({ env }),
      createRazorpayAdapter({ env }),
      createGenericAdapter({ env }),
    ].map((adapter) => [adapter.id, adapter]),
  );

  return {
    getAdapter(providerId: string, params?: unknown): ProviderAdapter {
      if (providerId === "generic-hmac" && params !== undefined)
        return createGenericAdapter({ env, params });
      const adapter = adapters.get(providerId);
      if (adapter === undefined) {
        throw new PaymentChaosError(
          "CONFIG_INVALID",
          messages.providerUnknown(providerId, [...adapters.keys()]),
        );
      }
      return adapter;
    },

    listFlows(providerFilter?: string): readonly FlowListing[] {
      const listings: FlowListing[] = [];
      for (const adapter of adapters.values()) {
        if (providerFilter !== undefined && adapter.id !== providerFilter) {
          continue;
        }
        for (const flow of adapter.flows) {
          listings.push({
            provider: adapter.id,
            id: flow.id,
            title: flow.title,
            events: flow.events,
          });
        }
      }
      return listings;
    },
  };
}
