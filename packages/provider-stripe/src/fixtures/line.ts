import type Stripe from "stripe";

// https://github.com/stripe/stripe-node/blob/v18.5.0/types/InvoiceLineItems.d.ts
export const invoiceLine = {
  id: "il_template", object: "line_item", amount: 1000, currency: "usd", description: null,
  discount_amounts: [], discountable: true, discounts: [], invoice: "in_template", livemode: false,
  metadata: {}, parent: { type: "subscription_item_details", invoice_item_details: null,
    subscription_item_details: { invoice_item: null, proration: false, proration_details: null,
      subscription: "sub_template", subscription_item: "si_template" } },
  period: { start: 0, end: 0 }, pretax_credit_amounts: [],
  pricing: { type: "price_details", price_details: { price: "price_template", product: "prod_template" }, unit_amount_decimal: "1000" },
  quantity: 1, subscription: "sub_template", taxes: [],
} satisfies Stripe.InvoiceLineItem;
