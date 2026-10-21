export const messages = {
  displayName: "Stripe",
  renewal: "Subscription renewal",
  cancellation: "Older cancellation after a newer subscription renewal",
  payment: "One-time payment",
  currency:
    "Stripe fixture currency is unsupported; use USD, EUR, GBP, JPY, INR, BRL, BHD, ISK or UGX.",
  country:
    "Stripe fixture country must be two letters; set params.country to an ISO 3166-1 alpha-2 code.",
  flow: "Stripe flow is unknown; choose subscription-renewal, cancellation-renewal-out-of-order or one-time-payment.",
  apiVersion: (supported: string) =>
    `Stripe API version is unsupported; set apiVersion to ${supported}.`,

  missingHeader: "Stripe signature header is missing; preserve the Stripe-Signature header.",
  malformedHeader:
    "Stripe signature header is malformed; preserve its timestamp and v1 signatures.",
  mismatch:
    "Stripe signature does not match; verify the endpoint key and preserve the raw body bytes.",
  stale: "Stripe signature is older than 300 seconds; use a fresh delivery timestamp.",
  timestamp: "Stripe signing timestamp is invalid; supply a finite UTC epoch instant.",
};
