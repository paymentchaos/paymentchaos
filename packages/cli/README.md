# paymentchaos

Deterministic failure testing for payment and subscription integrations.

## Run from a workspace checkout

This package is developed inside the PaymentChaos monorepo. Build dependencies and the CLI from the **repository root** (Node ≥ 22, pnpm via corepack):

```bash
pnpm install
pnpm build
```

Invoke the CLI with the workspace filter (links the `paymentchaos` bin to `packages/cli/dist/bin.js`):

```bash
pnpm --filter paymentchaos exec paymentchaos --help
pnpm --filter paymentchaos exec paymentchaos flows
```

Or call the built entrypoint directly:

```bash
node packages/cli/dist/bin.js run --help
```

Install `@paymentchaos/provider-stripe` in the workspace when running Stripe scenarios (orchestrator adds the dependency to this package when the provider lands).

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
pnpm --filter paymentchaos exec paymentchaos flows
pnpm --filter paymentchaos exec paymentchaos plan paymentchaos/scenarios/renewal.yaml --seed 1337
pnpm --filter paymentchaos exec paymentchaos run stripe-subscription-renewal
pnpm --filter paymentchaos exec paymentchaos run paymentchaos/scenarios/renewal.yaml --seed 1337 --repeat 5
pnpm --filter paymentchaos exec paymentchaos run paymentchaos/scenarios/renewal.yaml --seed 1337 --repeat 20 --repeat-index 4 --stable-ids
pnpm --filter paymentchaos exec paymentchaos run paymentchaos/scenarios/renewal.yaml --timeout-ms 15000
```

Quote scenario paths that contain spaces when invoking from a shell (single quotes on Unix, double quotes on Windows cmd.exe). Reproduce lines in reports quote paths automatically where needed.

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
