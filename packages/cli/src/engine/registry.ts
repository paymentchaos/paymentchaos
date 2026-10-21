import type { Env, ProviderAdapter } from "@paymentchaos/core";
import { PaymentChaosError } from "@paymentchaos/core";
import { messages } from "../messages.ts";
import type { FlowListing } from "./types.ts";

export interface ProviderRegistry {
  getAdapter(providerId: string): ProviderAdapter;
  listFlows(providerFilter?: string): readonly FlowListing[];
}

function isModuleNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

async function loadStripeAdapter(env: Env): Promise<ProviderAdapter | undefined> {
  try {
    const mod = await import("@paymentchaos/provider-stripe");
    return mod.createStripeAdapter({ env });
  } catch (error) {
    if (isModuleNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Loads every provider package that is installed in this workspace. */
export async function createProviderRegistry(env: Env = process.env): Promise<ProviderRegistry> {
  const adapters = new Map<string, ProviderAdapter>();
  const stripe = await loadStripeAdapter(env);
  if (stripe !== undefined) {
    adapters.set(stripe.id, stripe);
  }

  return {
    getAdapter(providerId: string): ProviderAdapter {
      const adapter = adapters.get(providerId);
      if (adapter === undefined) {
        throw new PaymentChaosError(
          "CONFIG_INVALID",
          messages.providerNotInstalled(providerId, [...adapters.keys()]),
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
