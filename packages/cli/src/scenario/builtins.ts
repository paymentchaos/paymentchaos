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
    chaos: [
      {
        reorder: ["invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"],
      },
    ],
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
    params: { currency: "INR" },
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
    chaos: [{ reorder: ["order.paid", "payment.captured"] }],
    repeat: 1,
  },
  {
    version: 1,
    name: "generic-hmac-duplicate",
    provider: "generic-hmac",
    flow: "user-event",
    params: {
      format: "standard-webhooks",
      events: [
        {
          type: "custom.created",
          body: '{ "type": "custom.created", "test": true, "name": "Zoë 東京" }\n',
        },
        { type: "custom.updated", body: '{"type":"custom.updated","test":true,"revision":2}' },
      ],
    },
    chaos: [
      { duplicate: { event: "custom.created", times: 2 } },
      { reorder: ["custom.updated", "custom.created"] },
      { concurrent: { event: "custom.created", deliveries: 2 } },
    ],
    repeat: 1,
  },
];

export const BUILTIN_NAMES = BUILTIN_SCENARIOS.map((s) => s.name);

export function findBuiltin(name: string): Scenario | undefined {
  return BUILTIN_SCENARIOS.find((s) => s.name === name);
}
