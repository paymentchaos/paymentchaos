import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asEventId, asInstant, asSecretRef, type SigningKeySet } from "@paymentchaos/core";
import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { sign } from "../../../packages/provider-stripe/src/signing.ts";
import { postStripeWebhook } from "../src/deliver.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const env = { STRIPE_WEBHOOK_SECRET: "whsec_test_raw_fixture" };
const keys: SigningKeySet = {
  current: asSecretRef("${STRIPE_WEBHOOK_SECRET}"),
};

describe("golden end-to-end: raw-byte Stripe signatures", () => {
  it("accepts unicode fixture bytes on the correct app and rejects naive re-serialization path", async () => {
    const unicodeBody = readFileSync(
      join(fixturesDir, "subscription-updated-unicode.fixture.json"),
    );
    const at = asInstant(1_750_000_000_000);
    const signed = sign(
      {
        body: unicodeBody,
        headers: { "content-type": "application/json" },
        event: { id: asEventId("evt_pc_unicode_sub"), type: "customer.subscription.updated" },
      },
      keys,
      at,
      env,
    );
    Stripe.webhooks.constructEvent(
      unicodeBody,
      signed.headers["stripe-signature"] ?? "",
      env.STRIPE_WEBHOOK_SECRET,
      300,
      undefined,
      at,
    );

    const correct = await startCorrectExample({ webhookSecret: env.STRIPE_WEBHOOK_SECRET });
    try {
      const ok = await postStripeWebhook(
        `${correct.baseUrl}/webhooks/stripe`,
        env.STRIPE_WEBHOOK_SECRET,
        unicodeBody,
        { eventType: "customer.subscription.updated", eventId: "evt_pc_unicode_sub" },
      );
      expect(ok.statusCode).toBe(200);
    } finally {
      await correct.close();
    }

    const naive = await startNaiveExample({ webhookSecret: env.STRIPE_WEBHOOK_SECRET });
    try {
      const bad = await postStripeWebhook(
        `${naive.baseUrl}/webhooks/stripe`,
        env.STRIPE_WEBHOOK_SECRET,
        unicodeBody,
        { eventType: "customer.subscription.updated", eventId: "evt_pc_unicode_sub" },
      );
      expect(bad.statusCode).toBe(400);
    } finally {
      await naive.close();
    }
  });
});
