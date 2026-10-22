# @paymentchaos/golden-e2e

Golden end-to-end tests for checkpoint 2: real HTTP deliveries via `@paymentchaos/core`
(`runScenario`) and, when built, the `paymentchaos` CLI subprocess. Example apps are
started on ephemeral ports with isolated SQLite files.

## Requirements

- Node >= 22.12 with `node:sqlite` (`--experimental-sqlite` on 22.12; see CI).
- Workspace packages built: `@paymentchaos/core`, `@paymentchaos/provider-stripe`.

## Commands

```bash
pnpm --filter @paymentchaos/golden-e2e test:e2e
pnpm --filter @paymentchaos/golden-e2e demo
```

`demo` runs `stripe-subscription-renewal` against naive (must fail business checks) and
correct (must pass). Set `GOLDEN_E2E_DEMO_ENGINE=core` to force the core runner when the
CLI is still on the contract fake engine.

## Scenarios

| Test | Scenario | What it proves |
|---|---|---|
| `golden.e2e.test.ts` | `stripe-subscription-renewal` | Five `invoice.paid` deliveries (duplicate×2 + concurrent×3) expose naive duplicate grants |
| `cancellation.e2e.test.ts` | `stripe-cancellation-out-of-order` | Stale `customer.subscription.deleted` on `subscription_2` must not clobber active `subscription` |
| `subscription-ordering.e2e.test.ts` | Hand-built subscription events | Correct app keeps state per subscription id: `canceled` never reverts (same-second ties included), and deleting an old subscription keeps a newer one active |
| `concurrency-race.e2e.test.ts` | Manual concurrent POST | Naive check-then-insert records >1 audited transition |
| `raw-body.e2e.test.ts` | Unicode fixture bytes | Correct app verifies raw bytes; naive rejects valid signatures |

## Assertion environment

Verification uses explicit `--base-url` (not inherited from the parent process). Customer
lookups use the Stripe `cus_…` id via `PAYMENTCHAOS_ID_CUSTOMER`. Active subscription
checks use `PAYMENTCHAOS_ID_SUBSCRIPTION`.

## Fixture provenance

- `fixtures/subscription-updated-unicode.fixture.json` — synthesized UTF-8 payload for
  raw-byte signature tests (not a recorded customer payload).
- Canonical renewal bodies come from the Stripe adapter shim / provider `encode()` (Unicode
  metadata, deterministic key order).

## Limits

- Event ordering assertions use per-object `created` timestamps, not a universal Stripe
  cursor (Stripe documents second-resolution ties).
- The golden shim mirrors provider lifecycle until `createStripeAdapter()` ships in
  `@paymentchaos/provider-stripe`.
