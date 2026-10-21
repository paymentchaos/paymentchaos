import { PaymentChaosError } from "@paymentchaos/core";
import type Stripe from "stripe";
import { messages } from "./messages.ts";

// SDK 18.5.0 was generated from Stripe OpenAPI for this exact version.
// https://github.com/stripe/stripe-node/blob/v18.5.0/src/apiVersion.ts
export const API_VERSION = "2025-08-27.basil" satisfies Stripe.LatestApiVersion;

export function checkVersion(version: string | undefined): void {
  if (version !== undefined && version !== API_VERSION) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.apiVersion(API_VERSION));
  }
}
