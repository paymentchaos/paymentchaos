# Stripe provider

The signing implementation uses Node's `crypto`; the official Stripe SDK is a
**development-only** oracle and shape validator. Synthetic signing keys in tests
are invented test data. Signing resolves core `SecretRef`s from the supplied
`Env`, without including resolved values in errors.

Stripe signs `timestamp + '.' + raw body` with HMAC-SHA256 and includes a `v1`
signature for each active secret during rotation. Verification accepts either
current or previous keys. Header names are case-insensitive; tokens follow the
pinned SDK's parsing rules. Multiple differently cased signature headers are
rejected as ambiguous. Nonfinite/unsafe/negative timestamps are rejected more
strictly than SDK `18.5.0`'s `parseInt`/NaN behavior.

The default age tolerance is 300 seconds, matching the SDK: reception time is
floored to Unix seconds, age exactly 300 passes, and future timestamps pass.
This is an age check, not an absolute clock-skew check. Raw bytes are never
parsed and reserialized on the signing path. Noncanonical whitespace and Unicode
in oracle tests make incorrect body handling observable.

Official sources:

- [Signature verification](https://docs.stripe.com/webhooks/signature)
- [Secret rotation](https://docs.stripe.com/webhooks#roll-endpoint-signing-secrets)
- [Pinned verifier implementation](https://github.com/stripe/stripe-node/blob/v18.5.0/src/Webhooks.ts)

Use the adapter through the single public factory:

```ts
import { createStripeAdapter } from "@paymentchaos/provider-stripe";
const stripe = createStripeAdapter({ env: process.env });
```

This returns core's `ProviderAdapter`. Omit `env` to resolve key references from
`process.env` at signing/verification time. The only supported API version is
**2025-08-27.basil**. See [fixture provenance and currency limits](./src/fixtures/README.md).

Flows are `subscription-renewal`, `cancellation-renewal-out-of-order` and
`one-time-payment`. Generation emits logical order. For cancellation delivered
last, configure reorder as `[invoice.paid, customer.subscription.updated,
customer.subscription.deleted]`. Named `ids.subscription` is the active
subscription; `ids.subscription_2` is the older canceled one. Default encoding is
canonical UTF-8 JSON containing Unicode, while a dedicated fixture tests raw-body
integrity through the signer and executor.

Provider timeout and exact retry intervals are `null` (officially unspecified).
[Stripe documents](https://docs.stripe.com/webhooks#automatic-retries) three
sandbox retries over a few hours and live retries up to three days with exponential
backoff. M1 retries are scenario-controlled. Core's separate configurable local
10,000 ms request budget does not claim to be Stripe's timeout. All 2xx statuses
are accepted per [Stripe's acknowledgement guidance](https://docs.stripe.com/webhooks#quickly-return-a-2xx-response).

Signing/reception clocks must be nonnegative safe integer UTC epoch milliseconds,
within JavaScript's Date range (through 8,640,000,000,000,000 ms). Header timestamps
must fit the corresponding Unix-second range. Invalid clocks fail closed before
age subtraction, so a NaN reception time cannot bypass staleness. This validation
is deliberately stricter than the SDK, without changing its future-time semantics.
`identify` recognizes a Stripe event envelope; it does not authenticate it.
