import type { Scenario } from "@paymentchaos/core";

/** Built-in scenarios shipped with the CLI (target comes from project config). */
export const BUILTIN_SCENARIOS: readonly Scenario[] = [
  {
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
  },
  {
    version: 1,
    name: "stripe-cancellation-out-of-order",
    provider: "stripe",
    flow: "cancellation-renewal-out-of-order",
    chaos: [{ reorder: ["customer.subscription.deleted", "invoice.paid"] }],
    repeat: 1,
  },
  {
    version: 1,
    name: "stripe-one-time-payment",
    provider: "stripe",
    flow: "one-time-payment",
    chaos: [{ duplicate: { event: "payment_intent.succeeded", times: 2 } }],
    repeat: 1,
  },
  {
    version: 1,
    name: "razorpay-subscription-charged",
    provider: "razorpay",
    flow: "subscription-charged",
    chaos: [
      { duplicate: { event: "subscription.charged", times: 2 } },
      { concurrent: { event: "subscription.charged", deliveries: 3 } },
    ],
    repeat: 1,
  },
  {
    version: 1,
    name: "razorpay-payment-captured",
    provider: "razorpay",
    flow: "payment-captured",
    chaos: [{ reorder: ["payment.captured", "order.paid"] }],
    repeat: 1,
  },
  {
    version: 1,
    name: "generic-hmac-duplicate",
    provider: "generic-hmac",
    flow: "user-event",
    chaos: [
      { duplicate: { event: "custom.event", times: 2 } },
      { reorder: ["custom.event", "custom.event"] },
      { concurrent: { event: "custom.event", deliveries: 2 } },
    ],
    repeat: 1,
  },
];

export const BUILTIN_NAMES = BUILTIN_SCENARIOS.map((s) => s.name);

export function findBuiltin(name: string): Scenario | undefined {
  return BUILTIN_SCENARIOS.find((s) => s.name === name);
}
