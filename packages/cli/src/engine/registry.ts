import type { Env, ProviderAdapter } from "@paymentchaos/core";
import { PaymentChaosError } from "@paymentchaos/core";
import { messages } from "../messages.ts";
import type { FlowListing } from "./types.ts";

export interface ProviderRegistry {
  getAdapter(providerId: string): ProviderAdapter;
  listFlows(providerFilter?: string): readonly FlowListing[];
}

const STRIPE_PACKAGE = "@paymentchaos/provider-stripe";

function isModuleNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function missingPackageInChain(error: unknown, packageName: string): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (isModuleNotFound(current) && errorMessage(current).includes(packageName)) {
      return true;
    }
  }
  return false;
}

function foreignModuleNotFoundInChain(error: unknown, packageName: string): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (isModuleNotFound(current) && !errorMessage(current).includes(packageName)) {
      return true;
    }
  }
  return false;
}

async function loadStripeAdapter(env: Env): Promise<ProviderAdapter | undefined> {
  try {
    const mod = await import(STRIPE_PACKAGE);
    return mod.createStripeAdapter({ env });
  } catch (error) {
    if (missingPackageInChain(error, STRIPE_PACKAGE)) {
      return undefined;
    }
    if (foreignModuleNotFoundInChain(error, STRIPE_PACKAGE)) {
      throw new PaymentChaosError(
        "INTERNAL",
        messages.providerLoadFailed("stripe", STRIPE_PACKAGE),
        { cause: error },
      );
    }
    throw new PaymentChaosError("INTERNAL", messages.providerLoadFailed("stripe", STRIPE_PACKAGE), {
      cause: error,
    });
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
