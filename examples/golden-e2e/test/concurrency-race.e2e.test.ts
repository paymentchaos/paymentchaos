import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import { describe, expect, it } from "vitest";
import { postStripeWebhook } from "../src/deliver.js";

function subscriptionUpdatedBody(params: {
  eventId: string;
  created: number;
  stripeCustomer: string;
  subscriptionId: string;
}): Buffer {
  const json = JSON.stringify({
    id: params.eventId,
    object: "event",
    api_version: "2025-08-27.basil",
    created: params.created,
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        id: params.subscriptionId,
        object: "subscription",
        customer: params.stripeCustomer,
        status: "active",
      },
    },
  });
  return Buffer.from(json, "utf8");
}

describe("golden end-to-end: subscription concurrency race", () => {
  it("naive app records multiple audited transitions for concurrent deliveries", async () => {
    const app = await startNaiveExample();
    try {
      const body = subscriptionUpdatedBody({
        eventId: "evt_pc_concurrent_probe",
        created: 1_730_000_500,
        stripeCustomer: "cus_pc_concurrency",
        subscriptionId: "sub_pc_concurrent",
      });

      const target = `${app.baseUrl}/webhooks/stripe`;
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          postStripeWebhook(target, app.webhookSecret, body, {
            eventType: "customer.subscription.updated",
            eventId: "evt_pc_concurrent_probe",
          }),
        ),
      );
      expect(results.every((row) => row.statusCode < 500)).toBe(true);

      const internalId = app.db
        .prepare("SELECT id FROM customers WHERE stripe_customer_id = ?")
        .get("cus_pc_concurrency") as { id: string } | undefined;
      expect(internalId).toBeDefined();
      const customerRowId = internalId?.id;
      expect(customerRowId).toBeDefined();

      const transitions = app.db
        .prepare("SELECT COUNT(*) AS n FROM subscription_transitions WHERE customer_id = ?")
        .get(customerRowId as string) as { n: number };
      expect(transitions.n).toBeGreaterThan(1);
    } finally {
      await app.close();
    }
  });

  it("correct app records a single transition under concurrent delivery", async () => {
    const app = await startCorrectExample();
    try {
      const body = subscriptionUpdatedBody({
        eventId: "evt_pc_concurrent_correct",
        created: 1_730_000_600,
        stripeCustomer: "cus_pc_concurrency_ok",
        subscriptionId: "sub_pc_concurrent_ok",
      });

      const target = `${app.baseUrl}/webhooks/stripe`;
      await Promise.all(
        Array.from({ length: 3 }, () =>
          postStripeWebhook(target, app.webhookSecret, body, {
            eventType: "customer.subscription.updated",
            eventId: "evt_pc_concurrent_correct",
          }),
        ),
      );

      const internalId = app.db
        .prepare("SELECT id FROM customers WHERE stripe_customer_id = ?")
        .get("cus_pc_concurrency_ok") as { id: string } | undefined;
      expect(internalId?.id).toBeDefined();
      const transitions = app.db
        .prepare("SELECT COUNT(*) AS n FROM subscription_transitions WHERE customer_id = ?")
        .get(internalId?.id as string) as { n: number };
      expect(transitions.n).toBe(1);
    } finally {
      await app.close();
    }
  });
});
