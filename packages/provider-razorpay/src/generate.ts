import {
  asEventId,
  type GenerateContext,
  type LogicalEvent,
  minorUnitsPerMajor,
  PaymentChaosError,
} from "@paymentchaos/core";
import type { Orders } from "razorpay/dist/types/orders.js";
import type { Payments } from "razorpay/dist/types/payments.js";
import type { Subscriptions } from "razorpay/dist/types/subscriptions.js";
import { messages } from "./messages.ts";

const notes = { paymentchaos: "synthetic-test", customer_name: "Zoë 東京 مرحبا" };

export function generate(flow: string, ctx: GenerateContext): LogicalEvent[] {
  if (ctx.apiVersion !== undefined) throw new PaymentChaosError("CONFIG_INVALID", messages.version);
  if (!["subscription-charged", "payment-captured"].includes(flow))
    throw new PaymentChaosError("CONFIG_INVALID", messages.flow);
  const currency = ctx.currency.toUpperCase();
  const amount = 100 * minorUnitsPerMajor(currency);
  const created_at = Math.floor(ctx.clock.now() / 1000);
  const order = ctx.ids.make("order");
  const customer = ctx.ids.make("cust");
  const account = ctx.ids.make("acc");
  // Official SDK 2.9.6 incorrectly types refund_status as the string 'null' and
  // bank as non-null, and requires offers even without expansion. Docs show nulls
  // and omit offers: https://razorpay.com/docs/webhooks/payloads/payments/
  // SDK card response inherits request-only number/cvv fields. Webhook card
  // projection follows https://razorpay.com/docs/webhooks/payloads/payments/
  const card = {
    id: ctx.ids.make("card"),
    entity: "card",
    name: notes.customer_name,
    last4: "1111",
    network: "Visa",
    type: "credit",
    issuer: "",
    international: currency !== "INR",
    emi: false,
  } satisfies Pick<
    Payments.RazorpayCard,
    "id" | "entity" | "name" | "last4" | "network" | "type" | "issuer" | "international" | "emi"
  >;
  const payment = {
    id: ctx.ids.make("pay"),
    entity: "payment",
    amount,
    currency,
    status: "captured",
    order_id: order,
    invoice_id: flow === "subscription-charged" ? ctx.ids.make("inv") : null,
    international: currency !== "INR",
    method: "card",
    amount_refunded: 0,
    refund_status: null,
    captured: true,
    description: "PaymentChaos synthetic test",
    card_id: card.id,
    card,
    bank: null,
    wallet: null,
    vpa: null,
    email: "zoe@example.test",
    contact: "+919000000000",
    customer_id: customer,
    token_id: null,
    notes,
    fee: 0,
    tax: 0,
    error_code: null,
    error_description: null,
    error_source: null,
    error_step: null,
    error_reason: null,
    acquirer_data: {},
    created_at,
  } satisfies Omit<Payments.RazorpayPayment, "refund_status" | "bank" | "offers" | "card"> & {
    refund_status: null;
    bank: null;
    card: typeof card;
  };
  const events: LogicalEvent[] = [];
  const emit = (type: string, payload: Record<string, { entity: unknown }>) => {
    events.push({
      id: asEventId(ctx.ids.make("evt")),
      type,
      occurredAt: ctx.clock.now(),
      object: {
        entity: "event",
        account_id: account,
        event: type,
        contains: Object.keys(payload),
        payload,
        created_at: Math.floor(ctx.clock.now() / 1000),
      },
    });
    ctx.clock.advance(1000);
  };
  if (flow === "subscription-charged") {
    // Webhook sample uses numeric remaining_count and null short_url, unlike SDK.
    // https://razorpay.com/docs/webhooks/payloads/subscriptions/#subscription-charged
    const subscription = {
      id: ctx.ids.make("sub"),
      entity: "subscription",
      plan_id: ctx.ids.make("plan"),
      customer_id: customer,
      status: "active",
      type: 2,
      current_start: created_at,
      current_end: created_at + 2592000,
      ended_at: null,
      quantity: 1,
      notes,
      charge_at: created_at + 2592000,
      start_at: created_at,
      end_at: created_at + 31104000,
      auth_attempts: 0,
      total_count: 12,
      paid_count: 1,
      customer_notify: false,
      created_at: created_at - 60,
      expire_by: created_at + 86400,
      short_url: null,
      has_scheduled_changes: false,
      change_scheduled_at: null,
      source: "api",
      remaining_count: 11,
    } satisfies Omit<
      Subscriptions.RazorpaySubscription,
      "remaining_count" | "short_url" | "payment_method"
    > & { remaining_count: number; short_url: null; type: number };
    emit("subscription.charged", {
      subscription: { entity: subscription },
      payment: { entity: payment },
    });
  } else {
    const paid = {
      id: order,
      entity: "order",
      amount,
      amount_paid: amount,
      amount_due: 0,
      currency,
      receipt: "paymentchaos-test",
      offer_id: null,
      status: "paid",
      attempts: 1,
      notes,
      created_at,
    } satisfies Omit<Orders.RazorpayOrder, "description" | "token">;
    // Logical sequence only; delivery order is not guaranteed by Razorpay.
    // https://razorpay.com/docs/webhooks/validate-test/#order-of-webhooks
    emit("payment.captured", { payment: { entity: payment } });
    emit("order.paid", { payment: { entity: payment }, order: { entity: paid } });
  }
  return events;
}
