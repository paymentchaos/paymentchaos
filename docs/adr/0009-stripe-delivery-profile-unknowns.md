# ADR 0009: Represent unpublished provider delivery timing

Status: Proposed · 2026-10-21 · Requires orchestrator approval

## Context

M1-B must implement the Stripe adapter against the frozen `ProviderAdapter`
contract. `DeliveryProfile.timeoutMillis` is documented as the timeout applied by
the provider, and `retryScheduleMillis` as the intervals between provider attempts.
Both fields are required and allow only concrete numeric values.

Stripe's official [automatic retry documentation](https://docs.stripe.com/webhooks#automatic-retries)
states that live-mode events are retried for up to three days with exponential
backoff. Sandbox events are retried three times over a few hours. It directs users
to the event destination's Event deliveries tab for the next retry time; it does
not specify the exact intervals. These are different policies, and generated
PaymentChaos events must have `livemode: false`.

The [endpoint documentation](https://docs.stripe.com/webhooks#quickly-return-a-2xx-response)
requires a quick successful response but does not specify a numeric timeout on
that page. No numeric timeout is proposed here without an official source.

Consequently, filling both required fields would either invent provider facts or
mislabel a local simulation policy as a Stripe guarantee. An empty retry array
would misleadingly describe a provider that does not retry. A zero, infinity or
arbitrary timeout would likewise misrepresent provider behavior.

## Proposed decision

Allow a delivery profile to distinguish documented provider behavior from local
simulation settings:

- Represent an unpublished provider timeout and unpublished exact retry intervals
  explicitly, rather than with numeric sentinel values.
- Record documented retry bounds separately, including sandbox versus live mode.
- Supply any deterministic local retry schedule and request timeout through an
  explicitly named simulation policy. These values must not claim to be Stripe's
  exact delivery timings.

The orchestrator should choose and approve the precise contract representation
and any M1 simulation defaults before the Stripe adapter is implemented. This ADR
does not change the frozen contracts or prescribe unsourced timing values.

An alternative is to retain the existing contract if an official Stripe source
establishing exact intervals and a timeout can be supplied. The adapter would then
cite that source and state which delivery mode its profile represents.

## Consequences

M1-B implementation is paused under the task's explicit stop-on-insufficient-
contract instruction. No engine, contracts, currency table or lockfile is changed.
The existing core currency helpers are sufficient for the requested JPY, INR and
BHD matrix. Signing, rotation, verification and lifecycle generation still fit
their existing interfaces; this proposal concerns delivery timing only.
