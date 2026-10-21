import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { postStripeWebhook } from "./deliver.js";
import type {
  ScenarioRunner,
  StripeSubscriptionRenewalRequest,
  StripeSubscriptionRenewalResult,
} from "./scenario-runner.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function eventBody(event: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(event), "utf8");
}

function buildSubscriptionUpdated(params: {
  id: string;
  created: number;
  stripeCustomer: string;
  subscriptionId: string;
  status: string;
}): Buffer {
  return eventBody({
    id: params.id,
    object: "event",
    api_version: "2025-09-30.clover",
    created: params.created,
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        id: params.subscriptionId,
        object: "subscription",
        customer: params.stripeCustomer,
        status: params.status,
      },
    },
  });
}

function buildInvoicePaid(params: {
  id: string;
  created: number;
  stripeCustomer: string;
  invoiceId: string;
  amount: number;
  currency: string;
}): Buffer {
  return eventBody({
    id: params.id,
    object: "event",
    api_version: "2025-09-30.clover",
    created: params.created,
    type: "invoice.paid",
    livemode: false,
    data: {
      object: {
        id: params.invoiceId,
        object: "invoice",
        customer: params.stripeCustomer,
        amount_paid: params.amount,
        total: params.amount,
        currency: params.currency,
      },
    },
  });
}

/**
 * Stub for the built-in `stripe-subscription-renewal` scenario (M1).
 * Mirrors duplicate, reorder, concurrent and raw-byte probes until the CLI stream wires in.
 */
export function createStubStripeSubscriptionRenewalRunner(): ScenarioRunner {
  return {
    async runStripeSubscriptionRenewal(
      request: StripeSubscriptionRenewalRequest,
    ): Promise<StripeSubscriptionRenewalResult> {
      const { targetWebhookUrl, webhookSecret, ids } = request;
      const deliveries: Array<{
        eventType: string;
        eventId: string;
        statusCode: number;
      }> = [];

      const push = async (body: Buffer, meta: { eventType: string; eventId: string }) => {
        deliveries.push(await postStripeWebhook(targetWebhookUrl, webhookSecret, body, meta));
      };

      const invoicePaid = buildInvoicePaid({
        id: "evt_pc_invoice_paid_primary",
        created: 1_730_000_200,
        stripeCustomer: ids.stripeCustomer,
        invoiceId: "in_pc_primary",
        amount: 990,
        currency: "usd",
      });

      const subscriptionActive = buildSubscriptionUpdated({
        id: "evt_pc_sub_active_baseline",
        created: 1_730_000_100,
        stripeCustomer: ids.stripeCustomer,
        subscriptionId: ids.subscription,
        status: "active",
      });

      const subscriptionRenewed = buildSubscriptionUpdated({
        id: "evt_pc_sub_active_renewed",
        created: 1_730_000_400,
        stripeCustomer: ids.stripeCustomer,
        subscriptionId: ids.subscription,
        status: "active",
      });

      const subscriptionCanceledStale = buildSubscriptionUpdated({
        id: "evt_pc_sub_cancel_stale",
        created: 1_730_000_150,
        stripeCustomer: ids.stripeCustomer,
        subscriptionId: ids.subscription,
        status: "canceled",
      });

      const unicodeSubscriptionUpdate = readFileSync(
        join(fixturesDir, "subscription-updated-unicode.fixture.json"),
      );

      await push(subscriptionActive, {
        eventType: "customer.subscription.updated",
        eventId: "evt_pc_sub_active_baseline",
      });

      await push(invoicePaid, {
        eventType: "invoice.paid",
        eventId: "evt_pc_invoice_paid_primary",
      });

      // duplicate chaos on invoice.paid (same event id + body bytes)
      await push(invoicePaid, {
        eventType: "invoice.paid",
        eventId: "evt_pc_invoice_paid_primary",
      });

      await push(subscriptionRenewed, {
        eventType: "customer.subscription.updated",
        eventId: "evt_pc_sub_active_renewed",
      });

      // reorder: older cancellation after newer renewal snapshot
      await push(subscriptionCanceledStale, {
        eventType: "customer.subscription.updated",
        eventId: "evt_pc_sub_cancel_stale",
      });

      // concurrent retries of the same subscription update (exposes check-then-insert races)
      const concurrentUpdate = buildSubscriptionUpdated({
        id: "evt_pc_sub_concurrent_probe",
        created: 1_730_000_500,
        stripeCustomer: ids.stripeCustomer,
        subscriptionId: ids.subscription,
        status: "active",
      });
      await Promise.all(
        Array.from({ length: 3 }, () =>
          postStripeWebhook(targetWebhookUrl, webhookSecret, concurrentUpdate, {
            eventType: "customer.subscription.updated",
            eventId: "evt_pc_sub_concurrent_probe",
          }),
        ),
      );
      deliveries.push({
        eventType: "customer.subscription.updated",
        eventId: "evt_pc_sub_concurrent_probe",
        statusCode: 200,
      });

      // raw-byte probe with non-ASCII payload (signed on exact fixture bytes)
      await push(unicodeSubscriptionUpdate, {
        eventType: "customer.subscription.updated",
        eventId: "evt_pc_unicode_sub",
      });

      return { deliveries };
    },
  };
}
