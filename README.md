<img src="assets/icon.svg" width="64" height="64" alt="">

# PaymentChaos

**Break your payment integration before production does.**

PaymentChaos is a deterministic failure-testing tool for payment and subscription integrations. It sends provider-accurate, correctly signed webhook deliveries to your application under controlled chaos (duplicate events, out-of-order delivery, concurrent retries), then checks your application's business state, not just its HTTP responses.

```text
PAYMENTCHAOS FAILED

Duplicate invoice.paid delivery created two entitlement records.
Expected: 1
Observed: 2
```

## Status

**Private testing prototype.** Stripe, Razorpay and generic HMAC flows work from a local
checkout. The included demo catches duplicate business records in a naive app and passes
the corrected app. Nothing is published to npm yet; use the local commands below.

## Try the demo

From this checkout, with the required tool versions installed:

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @paymentchaos/golden-e2e demo
```

The first app deliberately fails with duplicate entitlement and ledger records. The
corrected app passes. The demo starts isolated local apps and shuts them down afterward;
it does not charge real payments.

## Connect your app

From your application's development or staging checkout, invoke the built CLI using
the absolute path to this repository (replace `/path/to/paymentchaos`):

```bash
node /path/to/paymentchaos/packages/cli/dist/bin.js init --provider stripe --target http://127.0.0.1:3000/webhooks/stripe
```

This creates `paymentchaos.config.yaml` and `paymentchaos/verify.mjs`. Set the configured
signing-secret environment variable to your test app's secret, replace the deliberately
failing assertion starter with checks against your app's state, and start your app. Then:

```bash
node /path/to/paymentchaos/packages/cli/dist/bin.js run stripe-subscription-renewal --seed 1337
```

Choose `--provider razorpay` or `--provider generic-hmac` for those integrations. Run
`init --help` for options. Initialization never overwrites existing config or scaffold
directories and does not send webhooks. See the [CLI guide](packages/cli/README.md) and
[state assertion guide](apps/site/src/content/docs/docs/assertions.mdx).

The current prototype supports command-based assertions and terminal reports. HTTP
assertions are rejected until implemented; JSON/JUnit/HTML reporting is planned. Generated
provider IDs are synthetic, so apps that fetch provider objects may need test API mocks.
A passing concurrency run does not prove the absence of every race.

## Required versions

| Tool | Version | Pinned in |
|---|---|---|
| Node.js | 24.22.0 for development; >= 22.12.0 supported | `.node-version`, `.nvmrc`, `package.json#engines` |
| pnpm | 12.14.0, through Corepack | `package.json#packageManager` |

```bash
corepack enable pnpm
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

## Project documents

- [`docs/plan/BUILD_PROMPT.md`](docs/plan/BUILD_PROMPT.md): product specification and engineering requirements
- [`docs/plan/MULTI_AGENT_PLAN.md`](docs/plan/MULTI_AGENT_PLAN.md): milestones, work streams and review process
- [`AGENTS.md`](AGENTS.md): engineering rules for every contributor, human or agent
- [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md)

## License

[Apache-2.0](LICENSE)
