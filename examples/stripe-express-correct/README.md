# stripe-express-correct

The **positive** reference Stripe subscription webhook handler paired with `stripe-express-naive`. Same routes and data model, without the four M1 bug classes.

- `POST /webhooks/stripe` — verifies raw body bytes, then processes events
- `GET /__test__/state?customer=<cus_… or internal id>` — JSON snapshot for assertions: every subscription the customer has had (`subscriptions`, one row per Stripe subscription id) and the derived entitlement (`hasAccess`)
- `npm run verify -- <cus_…> --base-url http://127.0.0.1:PORT` — command assertion ([ADR 0005](../../docs/adr/0005-assertions.md))

## Run locally

```bash
pnpm install
export STRIPE_WEBHOOK_SECRET=whsec_test_correct_example
export PORT=4242
pnpm start
```

## Fixes applied (inverse of the naive app)

| Naive bug | Correct behavior |
|---|---|
| Duplicate `invoice.paid` grants twice | Atomic `INSERT OR IGNORE` on `event.id` before any entitlement or ledger writes |
| Check-then-insert race on subscription events | Same atomic event claim for every event type |
| Stale cancellation wins | State is stored per Stripe subscription id, ordered by `event.created`, and `canceled` never reverts. See [Subscription ordering](#subscription-ordering) |
| `JSON.stringify(req.body)` verification | `express.raw` + HMAC over exact bytes ([Stripe docs](https://docs.stripe.com/webhooks/signatures)) |

## Subscription ordering

Stripe does not deliver events in order, and an event's `created` timestamp is in whole seconds, so two events can share it. Stripe's guidance is not to rely on `created` alone to order events ([Event ordering](https://docs.stripe.com/webhooks#event-ordering)). This app applies `customer.subscription.updated` and `customer.subscription.deleted` with these rules (`src/webhooks.ts`, `src/subscriptions.ts`):

1. **One row per Stripe subscription id.** A customer can have several subscriptions over time. An event for one subscription never touches another subscription's row.
2. **Access is derived.** The customer has access while **any** of their subscriptions is `active` or `trialing`. Stripe says you can provision access in both states ([subscription statuses](https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses)). Canceling an old subscription therefore can't revoke access granted by a newer one.
3. **Older snapshots lose.** A snapshot whose `created` is strictly older than the stored one for the same subscription is ignored.
4. **Terminal statuses stick.** `canceled` and `incomplete_expired` are final for a subscription id. Stripe calls `canceled` "a terminal state that can't be updated". A customer who wants to resubscribe needs a *new* subscription, as does one whose subscription reached `incomplete_expired` ([subscription statuses](https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses), [cancel the subscription](https://docs.stripe.com/billing/subscriptions/overview#cancel-the-subscription)). Once stored, these statuses are never replaced, whatever `created` a later snapshot carries.
5. **Ties (same second): the later delivery wins.**
   - A terminal snapshot can't be followed by anything else for that id, so it wins its second and then sticks under rule 4. For example, a stale `customer.subscription.updated` (`active`) from the same second as a `customer.subscription.deleted` can't bring the subscription back.
   - A tie between two non-terminal snapshots (for example `past_due` and `active` in the same second) can't be ordered from the webhook alone.

All of this happens in one atomic `INSERT … ON CONFLICT … DO UPDATE … WHERE` statement, so concurrent deliveries can't interleave between a read and a write.

**In production, re-fetch when ordering is ambiguous.** This example works offline, so rule 5 is the best it can do with the webhook payload alone. Production code should handle a same-second tie between non-terminal snapshots by retrieving the subscription from the Stripe API (`GET /v1/subscriptions/:id`) and storing that, rather than trusting either snapshot. Stripe recommends using the API to retrieve current objects ([Event ordering](https://docs.stripe.com/webhooks#event-ordering)). Many integrations re-fetch on every subscription event for this reason.

## Unicode and byte-exact fixtures

The golden scenario includes a `customer.subscription.updated` fixture with non-ASCII metadata. Signatures are computed on the fixture bytes on disk; the handler never re-serializes the body for verification.

## Expected PaymentChaos outcome

The `stripe-subscription-renewal` scenario (duplicate, reorder, concurrent chaos) should leave exactly one renewal entitlement, one renewal ledger row, and an **active** subscription. `stripe-cancellation-out-of-order` must leave the renewed subscription active even though an older subscription's cancellation arrives late. `npm run verify` exits `0`.
