import { createCoreEngine } from "./core-engine.ts";
import { createProviderRegistry, type ProviderRegistry } from "./registry.ts";
import type { PaymentChaosEngine } from "./types.ts";

let defaultEngine: Promise<PaymentChaosEngine> | undefined;

/** Production engine: real core execution with installed provider packages. */
export function createEngine(registry?: ProviderRegistry): Promise<PaymentChaosEngine> {
  if (registry !== undefined) {
    return Promise.resolve(createCoreEngine(registry));
  }
  defaultEngine ??= createProviderRegistry().then(createCoreEngine);
  return defaultEngine;
}
