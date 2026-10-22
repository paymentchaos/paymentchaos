import type Stripe from "stripe";

// Synthesized full snapshots; every required field checked, no Partial<T> or casts.
// https://github.com/stripe/stripe-node/tree/v18.5.0/types
export const plan = {
  id: "price_template", object: "plan", active: true, amount: 1000, amount_decimal: "1000",
  billing_scheme: "per_unit", created: 0, currency: "usd", interval: "month", interval_count: 1,
  livemode: false, metadata: {}, meter: null, nickname: null, product: "prod_template",
  tiers_mode: null, transform_usage: null, trial_period_days: null, usage_type: "licensed",
} satisfies Stripe.Plan;

export const price = {
  id: "price_template", object: "price", active: true, billing_scheme: "per_unit", created: 0,
  currency: "usd", custom_unit_amount: null, livemode: false, lookup_key: null, metadata: {},
  nickname: null, product: "prod_template",
  recurring: { interval: "month", interval_count: 1, meter: null, trial_period_days: null, usage_type: "licensed" },
  tax_behavior: "unspecified", tiers_mode: null, transform_quantity: null, type: "recurring",
  unit_amount: 1000, unit_amount_decimal: "1000",
} satisfies Stripe.Price;

export const subscription = {
  id: "sub_template", object: "subscription", application: null, application_fee_percent: null,
  automatic_tax: { enabled: false, disabled_reason: null, liability: null }, billing_cycle_anchor: 0,
  billing_cycle_anchor_config: null, billing_mode: { type: "classic" },
  billing_thresholds: null, cancel_at: null, cancel_at_period_end: false, canceled_at: null,
  cancellation_details: null, collection_method: "charge_automatically", created: 0,
  currency: "usd", customer: "cus_template", days_until_due: null, default_payment_method: null,
  default_source: null, default_tax_rates: [], description: null, discounts: [], ended_at: null,
  invoice_settings: { account_tax_ids: null, issuer: { type: "self" } },
  items: { object: "list", data: [], has_more: false, url: "/v1/subscription_items?subscription=sub_template" },
  latest_invoice: "in_template", livemode: false, metadata: {}, next_pending_invoice_item_invoice: null,
  on_behalf_of: null, pause_collection: null, payment_settings: null, pending_invoice_item_interval: null,
  pending_setup_intent: null, pending_update: null, schedule: null, start_date: 0, status: "active",
  test_clock: null, transfer_data: null, trial_end: null, trial_settings: null, trial_start: null,
} satisfies Stripe.Subscription;
