import type { Scenario } from "@paymentchaos/core";

/** Mirrors CLI built-ins (target/assert merged at run time). */
export const STRIPE_SUBSCRIPTION_RENEWAL: Scenario = {
  version: 1,
  name: "stripe-subscription-renewal",
  provider: "stripe",
  flow: "subscription-renewal",
  chaos: [
    { duplicate: { event: "invoice.paid", times: 2 } },
    { reorder: ["invoice.paid", "customer.subscription.updated"] },
    { concurrent: { event: "invoice.paid", deliveries: 3 } },
  ],
  repeat: 1,
};

/** Logical order: deleted, invoice.paid, subscription.updated — reorder delivers deleted last. */
export const STRIPE_CANCELLATION_OUT_OF_ORDER: Scenario = {
  version: 1,
  name: "stripe-cancellation-out-of-order",
  provider: "stripe",
  flow: "cancellation-renewal-out-of-order",
  chaos: [
    {
      reorder: ["invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"],
    },
  ],
  repeat: 1,
};
