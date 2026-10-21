# stripe-express-correct

The **positive** reference Stripe subscription webhook handler paired with `stripe-express-naive`. Same routes and data model, without the four M1 bug classes.

- `POST /webhooks/stripe` — verifies raw body bytes, then processes events
- `GET /__test__/state?customer=<internal id>` — JSON snapshot for assertions
- `npm run verify` — command assertion script ([ADR 0005](../../docs/adr/0005-assertions.md))

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
| Stale cancellation wins | Subscription upsert only applies status when `event.created` is newer than stored |
| `JSON.stringify(req.body)` verification | `express.raw` + HMAC over exact bytes ([Stripe docs](https://docs.stripe.com/webhooks/signatures)) |

## Unicode and byte-exact fixtures

The golden scenario includes a `customer.subscription.updated` fixture with non-ASCII metadata. Signatures are computed on the fixture bytes on disk; the handler never re-serializes the body for verification.

## Expected PaymentChaos outcome

The `stripe-subscription-renewal` scenario (duplicate, reorder, concurrent chaos) should leave exactly one renewal entitlement, one renewal ledger row, and an **active** subscription. `npm run verify` exits `0`.
