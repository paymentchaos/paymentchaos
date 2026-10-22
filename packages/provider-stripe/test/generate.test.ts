import {
  createIdFactory,
  createLogicalClock,
  createRng,
  LOGICAL_EPOCH,
  PaymentChaosError,
} from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { generate } from "../src/generate.ts";

function context(currency = "USD", country = "US") {
  const rng = createRng(1337);
  return {
    rng,
    ids: createIdFactory(rng.fork("ids")),
    clock: createLogicalClock(),
    currency,
    country,
  };
}

// Full resource shapes are compile-checked with `satisfies Stripe.*` at construction.
// These assertions check relationships and amounts that SDK types cannot express.
describe("synthesized Stripe lifecycle snapshots", () => {
  it.each([
    ["USD", "US", 1_000_000],
    ["EUR", "FR", 1_000_000],
    ["GBP", "GB", 1_000_000],
    ["JPY", "JP", 10_000],
    ["INR", "IN", 1_000_000],
    ["BRL", "BR", 1_000_000],
    ["BHD", "BH", 10_000_000],
    ["ISK", "IS", 1_000_000],
    ["UGX", "UG", 1_000_000],
  ])("keeps %s minor-unit amounts and %s country consistent", (currency, country, amount) => {
    const ctx = context(String(currency).toLowerCase(), String(country).toLowerCase());
    const [paid, active] = generate("subscription-renewal", ctx);
    const ids = ctx.ids.named();
    expect(paid?.object).toMatchObject({
      id: ids.invoice,
      amount_paid: amount,
      total: amount,
      amount_remaining: 0,
      currency: String(currency).toLowerCase(),
      customer: ids.customer,
      customer_address: { country },
      parent: { subscription_details: { subscription: ids.subscription } },
      lines: {
        data: [
          {
            amount,
            invoice: ids.invoice,
            subscription: ids.subscription,
            parent: { subscription_item_details: { subscription_item: ids.si } },
            pricing: { price_details: { price: ids.price, product: ids.prod } },
          },
        ],
      },
    });
    expect(active?.object).toMatchObject({
      id: ids.subscription,
      customer: ids.customer,
      latest_invoice: ids.invoice,
      status: "active",
      currency: String(currency).toLowerCase(),
      items: {
        data: [
          { subscription: ids.subscription, price: { unit_amount: amount }, plan: { amount } },
        ],
      },
    });
    const once = context(String(currency), String(country));
    const [payment, checkout] = generate("one-time-payment", once);
    const oneIds = once.ids.named();
    expect(payment?.object).toMatchObject({
      id: oneIds.payment_intent,
      amount_received: amount,
      amount,
      customer: oneIds.customer,
      currency: String(currency).toLowerCase(),
    });
    expect(checkout?.object).toMatchObject({
      id: oneIds.checkout_session,
      payment_intent: oneIds.payment_intent,
      customer: oneIds.customer,
      amount_total: amount,
      customer_details: { address: { country } },
    });
  });

  it("cancels the old subscription and renews a different active subscription in logical order", () => {
    const ctx = context();
    const events = generate("cancellation-renewal-out-of-order", ctx);
    const ids = ctx.ids.named();
    expect(events.map((event) => event.type)).toEqual([
      "customer.subscription.deleted",
      "invoice.paid",
      "customer.subscription.updated",
    ]);
    expect(events.map((event) => event.occurredAt)).toEqual([
      LOGICAL_EPOCH,
      LOGICAL_EPOCH + 1000,
      LOGICAL_EPOCH + 2000,
    ]);
    expect(events[0]?.object).toMatchObject({
      id: ids.subscription_2,
      customer: ids.customer,
      status: "canceled",
      ended_at: LOGICAL_EPOCH / 1000,
      items: { data: [{ subscription: ids.subscription_2 }] },
    });
    expect(events[1]?.object).toMatchObject({
      parent: { subscription_details: { subscription: ids.subscription } },
    });
    expect(events[2]?.object).toMatchObject({
      id: ids.subscription,
      customer: ids.customer,
      status: "active",
    });
    expect(ids.subscription).not.toBe(ids.subscription_2);
  });

  it("rejects unsupported versions/currencies/countries/flows with typed config errors", () => {
    const ctx = context();
    for (const action of [
      () => generate("unknown", ctx),
      () => generate("one-time-payment", { ...ctx, currency: "MGA" }),
      () => generate("one-time-payment", { ...ctx, country: "India" }),
      () => generate("one-time-payment", { ...ctx, apiVersion: "2025-09-30.clover" }),
    ]) {
      expect(action).toThrow(PaymentChaosError);
      expect(action).toThrow(expect.objectContaining({ code: "CONFIG_INVALID" }));
    }
  });
});
