export const messages = {
  missingHeader: "Stripe signature header is missing; preserve the Stripe-Signature header.",
  malformedHeader:
    "Stripe signature header is malformed; preserve its timestamp and v1 signatures.",
  mismatch:
    "Stripe signature does not match; verify the endpoint key and preserve the raw body bytes.",
  stale: "Stripe signature is older than 300 seconds; use a fresh delivery timestamp.",
  timestamp: "Stripe signing timestamp is invalid; supply a finite UTC epoch instant.",
};
