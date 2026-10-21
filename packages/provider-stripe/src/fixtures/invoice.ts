import type Stripe from "stripe";

// Basil invoice subscription relationship lives in parent.subscription_details.
// https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects
// https://github.com/stripe/stripe-node/blob/v18.5.0/types/Invoices.d.ts
export const invoice = {
  id: "in_template", object: "invoice", account_country: "US", account_name: "PaymentChaos test",
  account_tax_ids: null, amount_due: 1000, amount_overpaid: 0, amount_paid: 1000,
  amount_remaining: 0, amount_shipping: 0, application: null, attempt_count: 1, attempted: true,
  auto_advance: false, automatic_tax: { enabled: false, disabled_reason: null, liability: null, provider: null, status: null },
  automatically_finalizes_at: null, billing_reason: "subscription_cycle", collection_method: "charge_automatically",
  created: 0, currency: "usd", custom_fields: null, customer: "cus_template", customer_address: null,
  customer_email: "zoe@example.test", customer_name: "Zoë 東京", customer_phone: null,
  customer_shipping: null, customer_tax_exempt: "none", customer_tax_ids: [], default_payment_method: null,
  default_source: null, default_tax_rates: [], description: null, discounts: [], due_date: null,
  effective_at: 0, ending_balance: 0, footer: null, from_invoice: null, hosted_invoice_url: null,
  invoice_pdf: null, issuer: { type: "self" }, last_finalization_error: null, latest_revision: null,
  lines: { object: "list", data: [], has_more: false, url: "/v1/invoices/in_template/lines" },
  livemode: false, metadata: {}, next_payment_attempt: null, number: "PC-TEST-0001", on_behalf_of: null,
  parent: { type: "subscription_details", quote_details: null, subscription_details: { metadata: {}, subscription: "sub_template" } },
  payment_settings: { default_mandate: null, payment_method_options: null, payment_method_types: null },
  period_end: 0, period_start: 0, post_payment_credit_notes_amount: 0, pre_payment_credit_notes_amount: 0,
  receipt_number: null, rendering: null, shipping_cost: null, shipping_details: null,
  starting_balance: 0, statement_descriptor: null, status: "paid",
  status_transitions: { finalized_at: 0, marked_uncollectible_at: null, paid_at: 0, voided_at: null },
  subtotal: 1000, subtotal_excluding_tax: 1000, test_clock: null, total: 1000,
  total_discount_amounts: [], total_excluding_tax: 1000, total_pretax_credit_amounts: [],
  total_taxes: [], webhooks_delivered_at: null,
} satisfies Stripe.Invoice;
