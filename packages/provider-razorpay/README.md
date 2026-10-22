# @paymentchaos/provider-razorpay

`createRazorpayAdapter({ env?, signingKey? })` implements `subscription-charged`
and `payment-captured` (`payment.captured`, then `order.paid`). Currency comes from
`GenerateContext.currency` / scenario `params.currency`; CLI core defaults to USD.
Set `params.currency: INR` to match the subscription documentation example. Amounts
are a synthetic 100 major units using core's currency-exponent table, not pricing.

Bodies use documented event envelopes and SDK-checked resource fields. The SDK
has documented nullability/type discrepancies, recorded beside the narrow type
corrections in source. No payload API version is claimed. All entities carry
`notes.paymentchaos: synthetic-test`: Razorpay documents identical live/test
payload structure rather than a `livemode` flag. Use only test targets and keys.

Signatures use HMAC-SHA256 over exact bytes, as lowercase hex in
`x-razorpay-signature`; `x-razorpay-event-id` remains stable on redelivery.
Verification accepts current or previous keys. Set `signingKey: previous` to
simulate an older retry (first previous key, current if none). Only one signature
is sent, unlike Stripe's multi-signature rotation format.

Official sources:
- https://razorpay.com/docs/webhooks/validate-test/ (signing, rotation, IDs, ordering, test mode)
- https://razorpay.com/docs/webhooks/best-practices/ (5-second timeout, non-2xx failure, 24-hour backoff bound; exact retry intervals unpublished)
- https://razorpay.com/docs/webhooks/payloads/payments/
- https://razorpay.com/docs/webhooks/payloads/orders/
- https://razorpay.com/docs/webhooks/payloads/subscriptions/

Timing metadata does not set the executor's local request timeout (ADR 0009).
