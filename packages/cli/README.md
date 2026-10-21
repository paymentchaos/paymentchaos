# paymentchaos

Deterministic failure testing for payment and subscription integrations.

## Install

From the monorepo root (requires Node ≥ 22 and pnpm):

```bash
pnpm install
pnpm --filter paymentchaos build
```

Install provider packages for the scenarios you run (for example `@paymentchaos/provider-stripe` when it is published in the workspace).

## Project config

Create `paymentchaos.config.yaml` at the project root with per-provider webhook targets:

```yaml
version: 1
providers:
  stripe:
    target:
      url: http://127.0.0.1:3000/webhooks/stripe
      secret: ${STRIPE_WEBHOOK_SECRET}
```

Scenario files under `paymentchaos/scenarios/` inherit these targets.

## Commands

```bash
# List lifecycle packs for installed providers
pnpm exec paymentchaos flows
pnpm exec paymentchaos flows stripe

# Compile a delivery plan (no network, no secret resolution)
pnpm exec paymentchaos plan paymentchaos/scenarios/renewal.yaml --seed 1337

# Run scenarios (prints the seed, dispatches webhooks, runs assertions)
pnpm exec paymentchaos run stripe-subscription-renewal
pnpm exec paymentchaos run paymentchaos/scenarios/renewal.yaml --seed 1337 --repeat 5
pnpm exec paymentchaos run paymentchaos/scenarios/renewal.yaml --seed 1337 --repeat 20 --repeat-index 4
pnpm exec paymentchaos run paymentchaos/scenarios/renewal.yaml --timeout-ms 15000
```

Remote targets require `--allow-remote-target <hostname>` matching the URL host.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Passed |
| 1 | Assertion or state check failed |
| 2 | Config / scenario / safety error |
| 3 | Target unreachable |
| 4 | Internal error |

## Engine integration

The CLI uses `@paymentchaos/core` (`compilePlan`, `runScenario`) with adapters loaded from installed `@paymentchaos/provider-*` packages. Tests use `@paymentchaos/core/testing` doubles; production code does not ship a fake provider.
