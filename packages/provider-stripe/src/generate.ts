import {
  asEventId,
  type GenerateContext,
  type LogicalEvent,
  minorUnitsPerMajor,
  PaymentChaosError,
} from "@paymentchaos/core";
import type Stripe from "stripe";
import { invoice as invoiceBase } from "./fixtures/invoice.ts";
import { invoiceLine } from "./fixtures/line.ts";
import { checkoutSession, paymentIntent } from "./fixtures/payment.ts";
import { plan, price, subscription as subscriptionBase } from "./fixtures/subscription.ts";
import { messages } from "./messages.ts";
import { checkVersion } from "./version.ts";

// Deliberately bounded synthesized matrix, not a claim of account presentment support.
const CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "INR", "BRL", "BHD", "ISK", "UGX"]);
const METADATA = {
  paymentchaos: "synthetic-test",
  customer_name: "Zoë 東京 مرحبا",
  note: "café / test",
};

export function generate(flow: string, ctx: GenerateContext): LogicalEvent[] {
  checkVersion(ctx.apiVersion);
  if (!CURRENCIES.has(ctx.currency.toUpperCase())) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.currency);
  }
  if (ctx.country !== undefined && !/^[A-Za-z]{2}$/.test(ctx.country)) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.country);
  }
  const currency = ctx.currency.toLowerCase();
  const country = ctx.country?.toUpperCase() ?? null;
  const metadata = { ...METADATA, ...(country === null ? {} : { country }) };
  // Fixed synthetic amount of 10,000 major units, not a provider pricing policy.
  // Integer arithmetic only; ISK/UGX retain two-digit API encoding.
  // https://docs.stripe.com/currencies#special-cases
  const amount =
    10_000 * minorUnitsPerMajor(currency) * (["isk", "ugx"].includes(currency) ? 100 : 1);
  const customer = ctx.ids.make("cus");
  // This is a logical scenario sequence, not a Stripe delivery-order guarantee.
  // https://docs.stripe.com/webhooks#event-ordering
  const events: LogicalEvent[] = [];
  const emit = (type: Stripe.Event.Type, object: Stripe.Event.Data.Object): void => {
    events.push({ id: asEventId(ctx.ids.make("evt")), type, object, occurredAt: ctx.clock.now() });
    ctx.clock.advance(1000);
  };
  const seconds = () => Math.floor(ctx.clock.now() / 1000);

  if (flow === "one-time-payment") {
    const created = seconds() - 60;
    const intent = {
      ...paymentIntent,
      id: ctx.ids.make("pi"),
      created,
      currency,
      customer,
      amount,
      amount_received: amount,
      latest_charge: ctx.ids.make("ch"),
      payment_method: ctx.ids.make("pm"),
      metadata,
    } satisfies Stripe.PaymentIntent;
    emit("payment_intent.succeeded", intent);
    emit("checkout.session.completed", {
      ...checkoutSession,
      id: ctx.ids.make("cs"),
      created,
      expires_at: created + 86400,
      currency,
      customer,
      metadata,
      payment_intent: intent.id,
      amount_subtotal: amount,
      amount_total: amount,
      customer_details: {
        address: { city: null, country, line1: null, line2: null, postal_code: null, state: null },
        email: "zoe@example.test",
        name: METADATA.customer_name,
        phone: null,
        tax_exempt: "none",
        tax_ids: [],
      },
    } satisfies Stripe.Checkout.Session);
    return events;
  }
  if (flow !== "subscription-renewal" && flow !== "cancellation-renewal-out-of-order") {
    throw new PaymentChaosError("CONFIG_INVALID", messages.flow);
  }

  // A canceled subscription cannot be renewed. Cancel the older subscription first;
  // the later renewal belongs to a DIFFERENT subscription for the same customer.
  // https://docs.stripe.com/api/subscriptions/cancel
  const subscription = ctx.ids.make("sub"); // Named `subscription` is the active one for assertions.
  const invoice = ctx.ids.make("in");
  const item = ctx.ids.make("si");
  const priceId = ctx.ids.make("price");
  const product = ctx.ids.make("prod");
  // Daily intervals avoid inventing month lengths for arbitrary injected instants.
  const start = seconds();
  const end = start + 86400;
  const priced = {
    ...price,
    id: priceId,
    product,
    created: start - 86400,
    currency,
    unit_amount: amount,
    unit_amount_decimal: String(amount),
    recurring: { ...price.recurring, interval: "day" },
  } satisfies Stripe.Price;
  const planned = {
    ...plan,
    id: priceId,
    product,
    created: priced.created,
    currency,
    amount,
    amount_decimal: String(amount),
    interval: "day",
  } satisfies Stripe.Plan;
  const subscriptionItem = {
    id: item,
    object: "subscription_item",
    billing_thresholds: null,
    created: start - 86400,
    current_period_start: start,
    current_period_end: end,
    discounts: [],
    metadata,
    plan: planned,
    price: priced,
    quantity: 1,
    subscription,
    tax_rates: [],
  } satisfies Stripe.SubscriptionItem;
  const active = {
    ...subscriptionBase,
    id: subscription,
    customer,
    currency,
    metadata,
    created: start - 86400,
    start_date: start - 86400,
    billing_cycle_anchor: start - 86400,
    latest_invoice: invoice,
    items: {
      object: "list",
      data: [subscriptionItem],
      has_more: false,
      url: `/v1/subscription_items?subscription=${subscription}`,
    },
  } satisfies Stripe.Subscription;
  if (flow === "cancellation-renewal-out-of-order") {
    const old = ctx.ids.make("sub");
    const oldItem = ctx.ids.make("si");
    emit("customer.subscription.deleted", {
      ...active,
      id: old,
      created: start - 259200,
      start_date: start - 259200,
      billing_cycle_anchor: start - 259200,
      status: "canceled",
      canceled_at: start,
      ended_at: start,
      latest_invoice: null,
      cancellation_details: { comment: null, feedback: null, reason: "cancellation_requested" },
      items: {
        ...active.items,
        url: `/v1/subscription_items?subscription=${old}`,
        data: [
          {
            ...subscriptionItem,
            id: oldItem,
            subscription: old,
            created: start - 259200,
            current_period_start: start - 86400,
            current_period_end: start,
          },
        ],
      },
    } satisfies Stripe.Subscription);
  }
  const paidAt = seconds();
  const line = {
    ...invoiceLine,
    id: ctx.ids.make("il"),
    amount,
    currency,
    invoice,
    metadata,
    subscription,
    period: { start, end },
    parent: {
      ...invoiceLine.parent,
      subscription_item_details: {
        ...invoiceLine.parent.subscription_item_details,
        subscription,
        subscription_item: item,
      },
    },
    pricing: {
      ...invoiceLine.pricing,
      unit_amount_decimal: String(amount),
      price_details: { price: priceId, product },
    },
  } satisfies Stripe.InvoiceLineItem;
  emit("invoice.paid", {
    ...invoiceBase,
    id: invoice,
    number: `PC-TEST-${invoice.slice(3)}`,
    customer,
    currency,
    metadata,
    amount_due: amount,
    amount_paid: amount,
    subtotal: amount,
    subtotal_excluding_tax: amount,
    total: amount,
    total_excluding_tax: amount,
    created: paidAt,
    effective_at: paidAt,
    customer_address: {
      city: null,
      country,
      line1: null,
      line2: null,
      postal_code: null,
      state: null,
    },
    period_start: start - 86400,
    period_end: start,
    status_transitions: {
      ...invoiceBase.status_transitions,
      finalized_at: paidAt,
      paid_at: paidAt,
    },
    lines: { ...invoiceBase.lines, data: [line], url: `/v1/invoices/${invoice}/lines` },
    parent: { ...invoiceBase.parent, subscription_details: { subscription, metadata } },
  } satisfies Stripe.Invoice);
  emit("customer.subscription.updated", active);
  return events;
}
