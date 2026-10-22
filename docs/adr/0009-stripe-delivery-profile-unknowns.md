# ADR 0009: Represent unpublished provider delivery timing

Status: Accepted · 2026-10-22 · Approved by the user on 2026-10-22 (orchestrator proposal); authorizes the `DeliveryProfile` timing change in `packages/core/src/contracts/provider.ts` only

## Context

M1-B must implement the Stripe adapter against the frozen `ProviderAdapter`
contract. `DeliveryProfile.timeoutMillis` was documented as the timeout applied by
the provider, and `retryScheduleMillis` as the intervals between provider attempts.
Both fields were required and allowed only concrete numeric values. The executor
also used `timeoutMillis` as its own request budget.

Stripe's official [automatic retry documentation](https://docs.stripe.com/webhooks#automatic-retries)
(checked 2026-10-22) publishes two different bounds:

- **Live mode:** Stripe attempts delivery "for up to three days with an exponential
  backoff". It points to the event destination's Event deliveries tab for the next
  retry time and does not publish the exact intervals.
- **Sandbox:** deliveries "created in a sandbox" are retried "three times over the
  course of a few hours". Exact intervals are not published.

Generated PaymentChaos events are always test events (`livemode: false`), so the
sandbox bound is the relevant one for what Stripe itself would do with them.

The [endpoint guidance](https://docs.stripe.com/webhooks#quickly-return-a-2xx-response)
requires a quick `2xx` "before any complex logic that could cause a timeout", and the
delivery status table lists a "Timed out" failure, but the page gives no numeric
timeout.

Filling the numeric fields would either invent provider facts or mislabel a local
simulation setting as a Stripe guarantee. An empty retry array would wrongly
describe a provider that does not retry.

## Decision

1. **Contract.** `DeliveryProfile.timeoutMillis` is `number | null` and
   `retryScheduleMillis` is `readonly number[] | null`. Both describe documented
   provider behavior only:
   - `null` means the provider does not publish the value (unpublished or unknown).
   - `[]` means the provider documents that it makes no automatic retries. It never
     stands in for "unknown".
   - A number or array is used only when an official source states it; the adapter
     cites that source next to the value (AGENTS.md rule 8).
2. **Local request timeout.** The executor's per-request timeout is a PaymentChaos
   execution setting, exported as `DEFAULT_REQUEST_TIMEOUT_MS = 10000` and
   configurable through `timeoutMillis` on both `executePlan` and `runScenario`.
   Precedence is: the caller's `timeoutMillis`, else the 10 000 ms default. The
   adapter's `deliveryProfile.timeoutMillis` never sets the budget, even when it is
   a number, so a local timeout is never presented as a provider guarantee and a
   provider fact never silently changes local strictness.
3. **Validation.** The selected local timeout must be an integer from 1 to
   2 147 483 647 ms, the largest delay `AbortSignal.timeout()` honors. Above it Node
   either clamps the delay to 1 ms with a warning (up to 2^32 − 1) or throws, so
   PaymentChaos rejects any value outside the range with `CONFIG_INVALID` before
   secrets are resolved, hooks run or any request is sent. The executor disables undici's own header and body timeouts on every request
   (`headersTimeout: 0`, `bodyTimeout: 0`, including on an injected dispatcher), so
   the local timeout is the only deadline for a whole request.
4. **Retries in M1.** The engine schedules no automatic retries. Redeliveries in M1
   are exactly those the scenario's chaos operators plan (`duplicate`, `concurrent`),
   so they are deterministic for a given seed. A future `retryOn5xx` operator may
   read `retryScheduleMillis`; when it is `null` it will need an explicitly named
   simulation schedule, which requires its own decision.
5. **Documented bounds.** Bounds that are published but not exact (Stripe's three
   days in live mode, three retries over a few hours in a sandbox) are recorded in
   the adapter's source comments and documentation with the link above, separately
   for each mode. They are not encoded as `retryScheduleMillis`.

## Consequences

- The Stripe adapter sets `timeoutMillis: null` and `retryScheduleMillis: null` and
  cites the retry documentation for both modes.
- Consumers that read these fields must handle `null`. In M1 only the executor read
  `timeoutMillis`, and it no longer does.
- An adapter that previously relied on its profile timeout to bound requests now
  gets the 10 000 ms local default unless the caller passes `timeoutMillis`.
- Built-in check 1 ("every validly signed delivery is accepted") judges acceptance
  within the local request timeout, which reports describe as a PaymentChaos
  setting.
- No other frozen contract changes.
