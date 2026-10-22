# Synthetic Stripe fixtures

Every fixture in this directory shares [provenance.json](./provenance.json).
Source is `synthesized`; `recordedAt` is null because none was recorded from an
account or the Stripe CLI. All names, addresses, keys and identifiers are invented.

The sole supported API version is **2025-08-27.basil**, matching the official
`stripe@18.5.0` SDK's generated
[API version](https://github.com/stripe/stripe-node/blob/v18.5.0/src/apiVersion.ts)
and [OpenAPI resource types](https://github.com/stripe/stripe-node/tree/v18.5.0/types).
Complete base resources and generated objects use `satisfies Stripe.*`, not partial
types or casts. Running the package typecheck validates every required field.
Runtime signing and encoding do not import the SDK.

The renewal uses a daily recurring price, one item, no discounts or taxes, and a
fully paid invoice. The invoice points to the subscription via
[`parent.subscription_details`](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects),
with consistent line/item/price/product relationships. The scenario's logical
order is not a Stripe delivery-order promise:
[Stripe doesn't guarantee event order](https://docs.stripe.com/webhooks#event-ordering).
The cancellation flow cancels an older subscription, then renews a separate newer
active subscription for the same customer. A canceled Stripe subscription is
[largely immutable](https://docs.stripe.com/api/subscriptions/cancel); the same
subscription is never resurrected.

Amounts are a fixed synthetic 10,000 major units, converted with core's shared ISO
helpers. Currency matrix: USD, EUR, GBP, JPY, INR, BRL, BHD, ISK, UGX. Codes are
lowercase on the wire. Stripe's [currency documentation](https://docs.stripe.com/currencies)
requires minor units, with [ISK/UGX special cases](https://docs.stripe.com/currencies#special-cases)
using 100 times ISO minor units. BHD exercises the shared three-decimal helper;
this is synthetic business-state test data, not a claim of account-specific
presentment availability. Account eligibility, settlement conversion, minimums,
maximums, payouts, taxes, discounts and fractional three-decimal restrictions are
not simulated. Other currency codes are rejected rather than inheriting core's
two-decimal fallback. No shared currency-table change is needed for this matrix.

Default lifecycle encoding is canonical UTF-8 JSON with Unicode metadata.
`noncanonical-renewal.fixture.json` was synthesized with seed 1337, JPY/JP and
core's fixed logical epoch. Its whitespace is deliberately significant: the raw
bytes pass official verification through the executor, while a consumer's JSON
reserialization fails. Fixtures must retain their exact bytes and LF endings.
