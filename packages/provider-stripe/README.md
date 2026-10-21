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
