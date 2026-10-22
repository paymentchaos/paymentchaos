import type Stripe from "stripe";

// Synthesized against stripe-node v18.5.0 generated OpenAPI types (Basil).
// https://github.com/stripe/stripe-node/tree/v18.5.0/types
export const paymentIntent = {
  id: "pi_template", object: "payment_intent", amount: 1000, amount_capturable: 0,
  amount_received: 1000, application: null, application_fee_amount: null,
  automatic_payment_methods: null, canceled_at: null, cancellation_reason: null,
  capture_method: "automatic", client_secret: null, confirmation_method: "automatic",
  created: 0, currency: "usd", customer: "cus_template", description: null,
  excluded_payment_method_types: null, last_payment_error: null, latest_charge: "ch_template",
  livemode: false, metadata: {}, next_action: null, on_behalf_of: null,
  payment_method: "pm_template", payment_method_configuration_details: null,
  payment_method_options: null, payment_method_types: ["card"], processing: null,
  receipt_email: null, review: null, setup_future_usage: null, shipping: null,
  source: null, statement_descriptor: null, statement_descriptor_suffix: null,
  status: "succeeded", transfer_data: null, transfer_group: null,
} satisfies Stripe.PaymentIntent;

export const checkoutSession = {
  id: "cs_test_template", object: "checkout.session", adaptive_pricing: null,
  after_expiration: null, allow_promotion_codes: null, amount_subtotal: 1000, amount_total: 1000,
  automatic_tax: { enabled: false, liability: null, provider: null, status: null },
  billing_address_collection: null, cancel_url: "https://example.test/cancel",
  client_reference_id: null, client_secret: null, collected_information: null,
  consent: null, consent_collection: null, created: 0, currency: "usd", currency_conversion: null,
  custom_fields: [], custom_text: { after_submit: null, shipping_address: null, submit: null, terms_of_service_acceptance: null },
  customer: "cus_template", customer_creation: "always", customer_details: null,
  customer_email: null, discounts: [], expires_at: 86400, invoice: null, invoice_creation: null,
  livemode: false, locale: null, metadata: {}, mode: "payment", origin_context: null,
  payment_intent: "pi_template", payment_link: null, payment_method_collection: "always",
  payment_method_configuration_details: null, payment_method_options: null, payment_method_types: ["card"],
  payment_status: "paid", permissions: null, recovered_from: null, saved_payment_method_options: null,
  setup_intent: null, shipping_address_collection: null, shipping_cost: null, shipping_options: [],
  status: "complete", submit_type: null, subscription: null, success_url: "https://example.test/success",
  total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, ui_mode: "hosted",
  url: null, wallet_options: null,
} satisfies Stripe.Checkout.Session;
