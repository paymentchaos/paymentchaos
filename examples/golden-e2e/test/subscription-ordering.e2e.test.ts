import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type RunningExample,
  startExample as startCorrectExample,
} from "@paymentchaos/example-stripe-express-correct/boot";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postStripeWebhook } from "../src/deliver.js";
import { parseChecks, runVerifyScript } from "../src/run-verify.js";

// Out-of-order subscription snapshots against the correct example, one rule at a time.
// Stripe's `created` has one-second resolution (https://docs.stripe.com/webhooks#event-ordering).

const exampleDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "stripe-express-correct",
);
const customer = "cus_pc_ordering_Zoë";
const T = 1_730_000_000;

interface SubscriptionRow {
  stripeSubscriptionId: string;
  status: string;
  grantsAccess: boolean;
}

interface StateBody {
  subscriptions: SubscriptionRow[];
  hasAccess: boolean;
}

let app: RunningExample;

beforeEach(async () => {
  app = await startCorrectExample();
});

afterEach(async () => {
  await app.close();
});

let eventSeq = 0;

async function deliver(params: {
  type: "customer.subscription.updated" | "customer.subscription.deleted";
  subscription: string;
  status: string;
  created: number;
}): Promise<void> {
  eventSeq += 1;
  const eventId = `evt_pc_ordering_${String(eventSeq)}`;
  const body = Buffer.from(
    JSON.stringify({
      id: eventId,
      object: "event",
      api_version: "2025-08-27.basil",
      created: params.created,
      type: params.type,
      livemode: false,
      data: {
        object: {
          id: params.subscription,
          object: "subscription",
          customer,
          status: params.status,
        },
      },
    }),
    "utf8",
  );
  const result = await postStripeWebhook(
    `${app.baseUrl}/webhooks/stripe`,
    app.webhookSecret,
    body,
    {
      eventType: params.type,
      eventId,
    },
  );
  expect(result.statusCode).toBe(200);
}

async function state(): Promise<StateBody> {
  const url = new URL("/__test__/state", app.baseUrl);
  url.searchParams.set("customer", customer);
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return (await response.json()) as StateBody;
}

function statusOf(body: StateBody, subscription: string): string | undefined {
  return body.subscriptions.find((row) => row.stripeSubscriptionId === subscription)?.status;
}

describe("correct example: subscription ordering", () => {
  it("keeps a subscription canceled when a same-second stale update arrives after the deletion", async () => {
    await deliver({
      type: "customer.subscription.deleted",
      subscription: "sub_a",
      status: "canceled",
      created: T,
    });
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_a",
      status: "active",
      created: T,
    });

    const body = await state();
    expect(statusOf(body, "sub_a")).toBe("canceled");
    expect(body.hasAccess).toBe(false);
  });

  it("keeps a subscription canceled even when a later-dated update for it arrives", async () => {
    await deliver({
      type: "customer.subscription.deleted",
      subscription: "sub_a",
      status: "canceled",
      created: T,
    });
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_a",
      status: "active",
      created: T + 5,
    });

    expect(statusOf(await state(), "sub_a")).toBe("canceled");
  });

  it("never reverts incomplete_expired", async () => {
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_a",
      status: "incomplete_expired",
      created: T,
    });
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_a",
      status: "active",
      created: T + 1,
    });

    expect(statusOf(await state(), "sub_a")).toBe("incomplete_expired");
  });

  it("does not let a newer deletion of an old subscription revoke a newer active one", async () => {
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_old",
      status: "active",
      created: T,
    });
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_new",
      status: "active",
      created: T + 60,
    });
    await deliver({
      type: "customer.subscription.deleted",
      subscription: "sub_old",
      status: "canceled",
      created: T + 120,
    });

    const body = await state();
    expect(statusOf(body, "sub_old")).toBe("canceled");
    expect(statusOf(body, "sub_new")).toBe("active");
    expect(body.hasAccess).toBe(true);

    const verify = await runVerifyScript({
      exampleDir,
      customerId: customer,
      baseUrl: app.baseUrl,
      env: { PAYMENTCHAOS_ID_SUBSCRIPTION: "sub_new" },
    });
    const checks = parseChecks(verify.stdout);
    expect(checks.find((row) => row.name === "subscription_active")?.pass).toBe(true);
    expect(checks.find((row) => row.name === "subscription_stripe_id")?.pass).toBe(true);
  });

  it("rejects a strictly older snapshot for the same subscription", async () => {
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_a",
      status: "past_due",
      created: T + 10,
    });
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_a",
      status: "active",
      created: T,
    });

    const body = await state();
    expect(statusOf(body, "sub_a")).toBe("past_due");
    expect(body.hasAccess).toBe(false);
  });

  it("lets the later delivery win a same-second tie between non-terminal snapshots", async () => {
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_a",
      status: "past_due",
      created: T,
    });
    await deliver({
      type: "customer.subscription.updated",
      subscription: "sub_a",
      status: "active",
      created: T,
    });

    expect(statusOf(await state(), "sub_a")).toBe("active");
  });
});
