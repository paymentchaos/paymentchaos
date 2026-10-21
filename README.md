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

**Pre-alpha. Not usable yet.** The first milestone (a thin prototype covering Stripe, Razorpay and generic HMAC webhooks) is under active development. Nothing is published to npm yet.

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
