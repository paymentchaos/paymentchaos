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

Stripe, Razorpay and generic HMAC adapters ship as static CLI dependencies.
`paymentchaos flows` lists all three providers.

## Project config

From your app's directory, use the absolute path to the built CLI:

```bash
node /path/to/paymentchaos/packages/cli/dist/bin.js init --provider stripe --target http://127.0.0.1:3000/webhooks/stripe
```

`init` detects Stripe/Razorpay dependencies and common Node frameworks in `package.json`.
With no provider dependency it defaults to Stripe; if both are detected, specify
`--provider`. Non-Node apps can use the same flags. It never installs dependencies or
runs package scripts. `--secret-env NAME` selects an environment variable name, not a
secret value. Generic HMAC defaults to the built-in Standard Webhooks scenario.

The generated `paymentchaos/verify.mjs` **fails until implemented**. Replace it with real
database or API checks using `PAYMENTCHAOS_IDS_JSON`; configure a reset hook if your
test requires one. Init sends no requests. Existing config files, scaffold directories,
and symlinks are refused. Remote targets require `--allow-remote-target <host>` during
initialization and again during `run`; permission is never saved in the config.

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

The CLI uses `@paymentchaos/core` (`compilePlan`, `runScenario`) with statically imported Stripe, Razorpay and generic HMAC adapters. Tests use `@paymentchaos/core/testing` doubles; production code does not ship a fake provider.

## Razorpay and generic HMAC

Configure `razorpay` and `generic-hmac` targets in the same way as Stripe above.
The new built-ins are `razorpay-subscription-charged` (INR by default),
`razorpay-payment-captured` (order paid delivered before payment captured), and
`generic-hmac-duplicate`. All currencies remain configurable in scenario params.

The generic built-in supplies inline test JSON for `custom.created` and
`custom.updated`, delivers the update first, then duplicates and concurrently
redelivers the creation. It uses the Standard Webhooks preset, so its secret env
variable must contain `whsec_` plus base64 encoding of 24–64 secret bytes. Configure
`params.format` and `params.events` in a project scenario for your own payloads;
see [the generic adapter documentation](../provider-generic/README.md).
Inline YAML strings are encoded exactly once, including whitespace and non-ASCII.
For programmatic CLI engines, the registry builds a separate configured generic
adapter per scenario, avoiding mutable global configuration.
