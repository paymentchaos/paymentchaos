# stripe-express-naive

Deliberately buggy Stripe subscription webhook handler used as the **negative** reference for PaymentChaos golden end-to-end tests.

The app is a minimal Express service backed by SQLite (`node:sqlite`). It models subscription entitlements for demo scenarios:

- `POST /webhooks/stripe` — Stripe-style signed webhooks
- `GET /__test__/state?customer=<cus_… or internal id>` — JSON snapshot for assertions
- `npm run verify -- <cus_…> --base-url http://127.0.0.1:PORT` — command assertion ([ADR 0005](../../docs/adr/0005-assertions.md))

## Run locally

```bash
pnpm install
export STRIPE_WEBHOOK_SECRET=whsec_test_naive_example
export PORT=4242
pnpm start
```

## The four intentional bugs

Each bug maps to a real production failure mode when webhooks are duplicated, concurrent or out of order.

### 1. No idempotency on Stripe event id (`invoice.paid`)

`invoice.paid` always inserts a renewal entitlement and ledger row. A duplicate delivery of the **same event id** grants twice.

**Fix:** Claim the Stripe `event.id` atomically (`INSERT OR IGNORE`) before side effects, or use an equivalent idempotency key tied to the event id.

### 2. Non-atomic check-then-insert idempotency

Subscription updates use `SELECT` → `await` → `INSERT` without a transaction or unique constraint enforcement on the happy path. Concurrent deliveries of the same event can both pass the check.

**Fix:** Make idempotency a single atomic operation (`INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`) and only process when the insert wins.

### 3. Older cancellation revokes a newer active subscription

Subscription snapshots overwrite status without comparing `event.created`. A stale `customer.subscription.updated` with `status=canceled` can arrive after a newer renewal and clobber active state.

**Fix:** Store the last applied `event.created` (or provider version) and ignore strictly older snapshots.

### 4. Signature verified against re-serialized JSON

The webhook route uses `express.json()` and verifies `JSON.stringify(req.body)` instead of the raw request bytes. This rejects valid provider payloads when key order, whitespace or Unicode normalization differs from Express’s parser output.

**Fix:** Verify the HMAC on the exact raw body buffer before parsing JSON ([Stripe docs](https://docs.stripe.com/webhooks/signatures)).

## Expected PaymentChaos outcome

Running the `stripe-subscription-renewal` scenario against this app should **fail** verification, for example:

```text
Duplicate invoice.paid delivery created 5 entitlement records.
  expected: 1
  observed: 5
```

(`duplicate`×2 plus `concurrent`×3 on the same logical `invoice.paid` → five deliveries.)

See `examples/golden-e2e` for the real core/CLI golden harness.
