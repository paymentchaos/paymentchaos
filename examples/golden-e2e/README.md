# @paymentchaos/golden-e2e

Golden end-to-end tests for checkpoint 2: real HTTP deliveries built by the Stripe adapter
(`createStripeAdapter()` from `@paymentchaos/provider-stripe`), sent through
`@paymentchaos/core` (`runScenario`) and through the built `paymentchaos` CLI as a
subprocess. Example apps are started on ephemeral ports with isolated SQLite files.

## Requirements

- Node >= 22.12 with `node:sqlite` (`--experimental-sqlite` on 22.12; see CI).
- Workspace packages built (`pnpm build`): `@paymentchaos/core`,
  `@paymentchaos/provider-stripe`, `@paymentchaos/report` and `paymentchaos`.

## Commands

```bash
pnpm --filter @paymentchaos/golden-e2e test:e2e
pnpm --filter @paymentchaos/golden-e2e demo
```

`demo` runs `paymentchaos run stripe-subscription-renewal --seed 1337` against naive
(must exit 1 on business checks) and correct (must exit 0), and prints the CLI's terminal
report. If `packages/cli/dist/bin.js` is missing it falls back to calling `runScenario`
directly; set `GOLDEN_E2E_DEMO_ENGINE=core` to choose that path even when the CLI is built.

The CLI runs each example's `verify.ts` assertion command through `/bin/sh` or `cmd.exe`.
`src/shell-quote.ts` quotes its arguments for that shell: single quotes on POSIX, double
quotes on Windows, where a path containing `"`, `%` or a line break is refused with an
error because cmd.exe cannot carry it safely.

## Scenarios

| Test | Scenario | What it proves |
|---|---|---|
| `golden.e2e.test.ts` | `stripe-subscription-renewal` | Five `invoice.paid` deliveries (duplicate×2 + concurrent×3) expose naive duplicate grants |
| `cancellation.e2e.test.ts` | `stripe-cancellation-out-of-order` | Stale `customer.subscription.deleted` on `subscription_2` must not clobber active `subscription` |
| `concurrency-race.e2e.test.ts` | Manual concurrent POST | Naive check-then-insert records >1 audited transition |
| `raw-body.e2e.test.ts` | Unicode fixture bytes | Correct app verifies raw bytes; naive rejects valid signatures |
| `cli.e2e.test.ts` | `stripe-subscription-renewal` via the `paymentchaos` CLI | The real CLI exits 1 on naive and 0 on correct |
| `shell-quote.test.ts` | — | POSIX and cmd.exe quoting of the assertion command, on any OS |

## Assertion environment

Verification uses explicit `--base-url` (not inherited from the parent process). Customer
lookups use the Stripe `cus_…` id via `PAYMENTCHAOS_ID_CUSTOMER`. Active subscription
checks use `PAYMENTCHAOS_ID_SUBSCRIPTION`.

## Fixture provenance

- `fixtures/subscription-updated-unicode.fixture.json` — synthesized UTF-8 payload for
  raw-byte signature tests (not a recorded customer payload).
- Canonical renewal bodies come from the Stripe adapter's `encode()` (Unicode metadata,
  deterministic key order).

## Limits

- Event ordering assertions use per-object `created` timestamps, not a universal Stripe
  cursor (Stripe documents second-resolution ties).
