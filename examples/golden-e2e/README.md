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
pnpm --filter @paymentchaos/golden-e2e sandbox /absolute/path/to/results
```

`demo` runs `paymentchaos run stripe-subscription-renewal --seed 1337` against naive
(must exit 1 on business checks) and correct (must exit 0), and prints the CLI's terminal
report. If `packages/cli/dist/bin.js` is missing it falls back to calling `runScenario`
directly; set `GOLDEN_E2E_DEMO_ENGINE=core` to choose that path even when the CLI is built.

The CLI runs each example's `verify.ts` assertion command through `/bin/sh` or `cmd.exe`.
`src/shell-quote.ts` quotes its arguments for that shell: single quotes on POSIX, double
quotes on Windows, where a path containing `"`, `%` or a line break is refused with an
error because cmd.exe cannot carry it safely.

## Private sandbox

`sandbox` runs 63 cases against the built CLI the way a new user would: `init` in an empty
project, every built-in flow for Stripe, Razorpay and generic HMAC, JPY/INR/BHD amounts,
duplicate side effects that must fail, wrong signing keys, HTTP 400/429/500/302 and slow
handlers, an unreachable target, hooks, `settle`, false JSON checks, unsupported
`assert.http`, invalid config, missing secrets, usage errors and the remote-target guard.

A local server verifies every delivery with the provider's official SDK (`stripe`,
`razorpay`, `standardwebhooks`) and records side effects per event. Each case gets its own
folder whose name contains a space and non-ASCII characters. The folder keeps the config,
assertion scripts, redacted command logs and `observations.json`, and the run writes
`RESULTS.md` and `results.json`. Signing secrets are random per run and never written to
disk. A case passes when the observed outcome matches the expected one, so deliberately
broken handlers must fail. `test/sandbox.e2e.test.ts` runs the same matrix in CI.

Each CLI invocation has a 20-second limit. On timeout the harness terminates its child
process tree, including assertion and hook commands, before starting another case. This
uses `ps` on Linux/macOS and `taskkill` on Windows. If cleanup fails, the matrix stops.

It does not cover real provider accounts, production databases, email, load, or proof that
a race cannot happen.

## Scenarios

| Test | Scenario | What it proves |
|---|---|---|
| `golden.e2e.test.ts` | `stripe-subscription-renewal` | Five `invoice.paid` deliveries (duplicate×2 + concurrent×3) expose naive duplicate grants |
| `cancellation.e2e.test.ts` | `stripe-cancellation-out-of-order` | Stale `customer.subscription.deleted` on `subscription_2` must not clobber active `subscription` |
| `subscription-ordering.e2e.test.ts` | Hand-built subscription events | Correct app keeps state per subscription id: `canceled` never reverts (same-second ties included), and deleting an old subscription keeps a newer one active |
| `concurrency-race.e2e.test.ts` | Manual concurrent POST | Naive check-then-insert records >1 audited transition |
| `raw-body.e2e.test.ts` | Unicode fixture bytes | Correct app verifies raw bytes; naive rejects valid signatures |
| `cli.e2e.test.ts` | `stripe-subscription-renewal` via the `paymentchaos` CLI | The real CLI exits 1 on naive and 0 on correct |
| `sandbox.e2e.test.ts` | All built-in flows and custom scenarios via the CLI | The 63-case private sandbox matrix matches every expected outcome |
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
