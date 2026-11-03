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

**Development prototype for early validation.** Stripe, Razorpay and generic HMAC flows work from a local
checkout. The included demo catches duplicate business records in a naive app and passes
the corrected app. Nothing is published to npm yet; use the local commands below.
Failure reports print a reproduction command using the Node executable and CLI copy
that ran, so copying it does not fetch a package from npm. Run it from the same app directory.

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

## Download CI demo reports

Each [CI run](https://github.com/paymentchaos/paymentchaos/actions/workflows/ci.yml)
builds the CLI and runs the included naive and corrected apps with both JSON and JUnit
reporters. Open a completed run and download a `demo-reports-…` artifact for its OS and
Node version. The artifacts are retained for 14 days. GitHub requires a signed-in account
to download workflow artifacts.

The naive reports deliberately contain failed business assertions (CLI exit `1`); the
corrected reports pass (exit `0`). The demo job succeeds only when those expected outcomes
match. A configuration error or missing report fails the job. Reports from a failed job
may be incomplete, so always inspect the job result as well as the downloaded files.

To generate the same reports locally after building, use a new output directory:

```bash
pnpm --filter @paymentchaos/golden-e2e demo:ci --out /absolute/path/to/demo-reports
```

The demo uses local example apps and synthetic data. For your own app, see the
[report options](packages/cli/README.md#reports); check the CLI exit code and use fresh
artifact paths, since an aborted invocation leaves an existing output file unchanged.

## Install the private beta

To use PaymentChaos from any project without this checkout, build a private archive.
It bundles every runtime dependency, so it installs offline and never fetches an
unpublished package:

```bash
pnpm pack:private
npm install --global ./dist/private-beta/<version>-*/paymentchaos-<version>.tgz
paymentchaos --version
```

The command prints the archive path, its SHA-256 and the commit it was built from. That
information is also saved in `manifest.json` next to the archive. You can copy the archive
to another machine with Node >= 22.12. `pnpm test:private-package` installs it offline into
a fresh folder and runs the 63-case sandbox against it. CI runs that check on Linux and
Windows.

The installed-package check also exercises symlinked temporary directories, matching
the default macOS layout, so the archive retains its bundled dependencies there.

## Connect your app

From your application's development or staging checkout, run `paymentchaos` if you
installed the private beta. Otherwise, invoke the built CLI using the absolute path to
this repository (replace `/path/to/paymentchaos`):

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

The current prototype supports command-based assertions and terminal, JSON and JUnit reports
(`--reporter json` or `--reporter junit`; see the [report guide](packages/cli/README.md#reports)).
HTTP assertions are rejected until implemented; HTML reporting is planned. Generated
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
