# PaymentChaos — Master Build Prompt

> Give this prompt, together with `AGENTS.md` and `docs/plan/MULTI_AGENT_PLAN.md`, to every coding agent working on PaymentChaos. Each agent also receives a task-specific prompt from the multi-agent plan. When this document and a task prompt disagree, this document wins unless an accepted ADR in `docs/adr/` says otherwise.

---

## 1. Role

You are a senior engineer building **PaymentChaos**: an open-source, developer-first CLI and library that proves payment, subscription and entitlement code stays correct when webhooks are duplicated, delayed, reordered, retried concurrently, signed incorrectly or partially fail.

You are building a product that teams anywhere in the world will run against their own backend, written in any language, on macOS, Linux or Windows, with any currency and locale. Treat correctness, determinism, security and portability as product features. Do not treat them as polish.

**Positioning:** Break your payment integration before production does.

**One-line definition:** Deterministic failure testing for payment and subscription integrations.

## 2. The problem you are solving

Payment providers deliver webhooks **at least once** and **out of order**. Stripe retries live events for up to three days. Razorpay documents duplicate and out-of-order events and may sign older retries with a previous secret. Signature verification needs the **unmodified raw request body**. Endpoints must acknowledge quickly and process asynchronously.

Most teams test only the happy path: one event, delivered once, in order. Real bugs show up later in production as:

- Entitlements granted twice for one renewal.
- An older `cancelled` event revoking a newer active subscription.
- Two concurrent deliveries of the same event both passing an idempotency check that isn't atomic.
- Valid events rejected because the app verified a re-serialized body instead of the raw bytes.
- Invalid or replayed signatures accepted (a security bug).
- Ledgers that disagree with the provider after a failed-then-successful payment.

Each provider only tests its own platform, and existing tools (Hookdeck, Svix Play, ngrok inspector, webhook.build) capture and replay HTTP traffic. **None of them assert on application business state.** That gap is PaymentChaos.

The question PaymentChaos answers:

> Can this event sequence corrupt our payment, subscription, order or entitlement state?

## 3. Product boundaries

PaymentChaos **is**:

- A local-first CLI (`npx paymentchaos`) plus TypeScript libraries.
- A deterministic chaos scheduler for provider-accurate, correctly signed webhook deliveries.
- An assertion runner that checks the developer's **application state** after (and during) a scenario.
- A CI tool: non-zero exit code on failure, JSON, JUnit and HTML reports, and a GitHub Action.

PaymentChaos **is not**, and must not grow into: a payment processor, a production webhook gateway, a tunnel, a request bin, a Postman-style API client, a generic load tester, an observability platform, a RevenueCat replacement, or an AI code reviewer. Reject features that pull it toward those products.

## 4. Global-first requirements (non-negotiable)

These apply from the first commit, even though the first providers are Stripe and Razorpay.

1. **Language-agnostic targets.** PaymentChaos talks HTTP to the developer's app. The app may be Node, Python, Go, Ruby, PHP, Java, .NET or Elixir. Never assume the target is a Node process. Ship a Docker image so teams without Node can run it.
2. **Cross-platform.** macOS, Linux and Windows are tier-1 and run in CI. No native Node add-ons in the CLI install path. Use `node:path`, not string concatenation. Run assertion commands through the platform shell and document how quoting differs.
3. **Raw bytes survive every OS.** Fixtures are byte-exact. Add `.gitattributes` rules (`*.fixture.json -text`, `fixtures/** -text`) so Git line-ending conversion on Windows can't change signed bytes. Read and write fixtures as `Buffer`, never as re-serialized JSON.
4. **Money is minor units plus an ISO 4217 currency, always.** Use a single currency-exponent table: zero-decimal (JPY, KRW, VND, CLP, …), two-decimal, and three-decimal (BHD, KWD, OMR, JOD, TND). Encode provider-specific exceptions in the provider adapter, never in core. Lifecycle packs take `currency` and `country` parameters. The test matrix includes at least USD, EUR, GBP, JPY, INR, BRL and BHD.
5. **Time is UTC.** Internal time is a monotonic logical clock plus UTC instants. Each adapter owns its provider's timestamp format (Unix seconds, milliseconds or RFC 3339). Reports show UTC in ISO 8601. Never format with the host's local timezone in machine output.
6. **Unicode everywhere.** Fixtures include non-ASCII names, addresses and descriptions (for example `Zoë Ångström`, `山田太郎`, `محمد`, `Ñoño`) and unusual-but-valid JSON whitespace and key order. These cases expose apps that verify signatures against `JSON.stringify(req.body)`.
7. **Privacy by default.** No telemetry in v0.x. Captured payloads stay on the developer's machine. Sanitization must handle global personally identifiable information (PII): emails, E.164 and national phone numbers, names, multi-country addresses, tax IDs (VAT, GSTIN, CPF/CNPJ, ABN, EIN), IBANs, UPI VPAs, IP addresses, card fingerprints and last-4 digits, and user-configured JSON paths.
8. **English first, i18n-ready.** Keep all user-facing CLI and report strings in one message module so they can be translated later. Structure the docs site (Astro Starlight) for i18n.
9. **Licensing.** The core, CLI, providers, reports and GitHub Action are Apache-2.0 (its explicit patent grant suits enterprises). The hosted team product, built later, lives in a separate repository.

## 5. Safety requirements

PaymentChaos sends **validly signed** payment events. Pointed at production with a real secret, it could grant real entitlements.

- By default, refuse any target that isn't a loopback address, a private-network address or a hostname ending in `.localhost`, `.test` or `.internal`. Remote targets require `--allow-remote-target <host>`, with an explicit host and no wildcard.
- Every generated event is marked as test or sandbox using each provider's own convention (for example Stripe `livemode: false`).
- Load secrets only from environment variables or a secrets file referenced as `${ENV_VAR}`. Never write a secret to stdout, logs or any report format. Redact secrets in error messages.
- Assertion commands run with an explicit, documented environment. Never pass the parent environment's secrets through implicitly. Use an allowlist plus `PAYMENTCHAOS_*` variables.
- The capture listener binds to `127.0.0.1` by default.

## 6. Core concepts and domain model

Design around these concepts and name them consistently in code, docs and reports:

| Concept | Meaning |
|---|---|
| **Provider adapter** | Encodes one provider's event shapes, IDs, signing scheme, delivery profile and redaction rules. |
| **Lifecycle pack (flow)** | A named, parameterized sequence of logical events, such as `subscription-renewal`. |
| **Logical event** | One provider event with a stable event ID and an object snapshot. One logical event may be delivered many times. |
| **Delivery** | One HTTP attempt carrying a logical event: exact body bytes, signed headers, send time, concurrency group and attempt number. |
| **Chaos operator** | A pure function that transforms a delivery plan: `(plan, rng, params) => plan`. |
| **Delivery plan** | The fully compiled, deterministic list of deliveries. It is printable, diffable and hashable. |
| **Executor** | Sends the plan to the target and records responses, timings and errors. |
| **Assertion** | A check on HTTP behavior (built in) or on application state (user-defined). |
| **Run** | One execution of a scenario: seed, plan hash, timeline, assertion results and environment. |

Keep two kinds of duplicate distinct:

- **Redelivery:** the same event ID, the same body bytes and a fresh signature timestamp. This is what providers do on retry.
- **Semantic duplicate:** a different event ID carrying the same underlying state change. Idempotency keyed only on event ID does not catch this. PaymentChaos must test both.

## 7. Determinism model (be honest about it)

- Each run has a **seed** (random by default, printed always, set with `--seed`). The seed plus the scenario file plus the PaymentChaos version produces a byte-identical delivery plan and the same **plan hash**. Test this property directly.
- Use a self-contained, versioned PRNG (for example xoshiro128** or sfc32). Never use `Math.random()` in planning code.
- Provider-shaped IDs (`evt_…`, `cus_…`, `sub_…`, `in_…`, `pay_…`, `order_…`) come from the seeded PRNG plus a run nonce, so repeated runs against a persistent database don't collide. `--stable-ids` turns the nonce off.
- **The dispatch order is deterministic. The target server's interleaving is not.** Concurrent groups are released together behind a barrier. To expose races, scenarios support `repeat: N`, and the report states how many repetitions failed. Never claim a concurrency test proves the absence of a race.
- Delays are real wall-clock time on the wire, scaled by a `timeScale` so that, for example, a three-day Stripe retry schedule runs in seconds.

## 8. Signing architecture

The concept interface in the original notes, `sign(rawBody, secret): SignedHeaders`, is **too narrow** for a global product. Providers sign in fundamentally different ways:

| Scheme | Examples | Notes |
|---|---|---|
| HMAC over raw body | Razorpay, Lemon Squeezy, Shopify, GitHub (`sha256=`) | hex or base64 encoding, configurable header and prefix |
| HMAC over timestamp + body | Stripe (`t=…,v1=…`), Paddle Billing (`ts=…;h1=…`), Standard Webhooks (`webhook-id.webhook-timestamp.body`) | timestamp tolerance; multiple signatures during secret rotation |
| HMAC over selected body fields | Adyen | the signature lives **inside** the body |
| Asymmetric / JWS | Apple App Store Server Notifications v2, Standard Webhooks `v1a` (Ed25519) | test certificate authorities, keys and certificate chains |
| Remote-verified | PayPal, Google Play RTDN via Pub/Sub OIDC | can't be signed locally; needs a documented verification-mock mode |

Model the signer as producing a complete `SignedDelivery` (headers and, if needed, a body transform), and model signing keys as a set that supports rotation (`current`, `previous[]`). v0.1 implements only the first two rows, but the interface must accommodate all five without breaking changes.

Indicative contract (refine it in an ADR during Phase 0):

```ts
export interface ProviderAdapter {
  readonly id: string;                         // "stripe"
  readonly displayName: string;
  readonly apiVersions: readonly string[];     // payload shapes vary by provider API version
  readonly flows: FlowCatalog;                 // lifecycle packs this provider supports
  readonly deliveryProfile: DeliveryProfile;   // timeoutMs, retrySchedule, signatureToleranceSec, acceptedStatuses
  readonly redactionRules: readonly RedactionRule[];

  generate(flow: FlowId, ctx: GenerateContext): LogicalEvent[];  // ctx: rng, ids, clock, currency, country, apiVersion
  encode(event: LogicalEvent, ctx: EncodeContext): Buffer;       // exact bytes on the wire
  sign(delivery: UnsignedDelivery, keys: SigningKeySet, at: Instant): SignedDelivery;
  verify(request: CapturedRequest, keys: SigningKeySet): VerifyResult; // capture mode and free tools
  identify(request: CapturedRequest): IdentifiedEvent | null;
}
```

## 9. Scenario format

YAML for humans, plus a typed TypeScript API (`defineScenario`) for programmatic use. Both compile to the same validated model. Generate a published JSON Schema (`schemas/scenario.v1.json`) from the zod definitions so editors autocomplete. Every file declares `version: 1`.

```yaml
version: 1
name: renewal survives duplicates and reordering
provider: stripe
apiVersion: "2025-09-30.clover"     # adapter-supported version
flow: subscription-renewal
params:
  currency: jpy
  country: JP

target:
  url: http://localhost:3000/webhooks/stripe
  secret: ${STRIPE_WEBHOOK_SECRET}

hooks:
  beforeEach: npm run test:reset-db
  afterEach: null

chaos:
  - duplicate: { event: invoice.paid, times: 2 }
  - reorder: [invoice.paid, customer.subscription.updated]
  - concurrent: { event: invoice.paid, deliveries: 3 }
  - lostAck: { event: invoice.paid }            # target processed it, provider "didn't see" the 2xx and retries
  - timeout: { event: invoice.paid, afterMs: 50 } # client aborts mid-processing, then redelivers

assert:
  settle: { timeoutMs: 5000, intervalMs: 250 }  # apps that ack fast and process async
  command: npm run verify-test-entitlement
  http:
    url: http://localhost:3000/__test__/state?customer={{ids.customer}}
    expect:
      "$.subscription.status": active
      "$.entitlements.length": 1
      "$.ledger[?(@.type=='renewal')].length": 1

repeat: 20
seed: 1337
```

**Command assertion protocol:** exit code `0` passes, non-zero fails. A command *may* print one JSON document to stdout, `{ "checks": [{ "name", "pass", "expected", "observed", "message" }] }`, for rich reporting. Pass IDs and run metadata to the command as `PAYMENTCHAOS_RUN_ID`, `PAYMENTCHAOS_SEED`, `PAYMENTCHAOS_IDS_JSON` and `PAYMENTCHAOS_ID_<NAME>`.

## 10. Built-in checks (on by default; each can be turned off with a reason)

The first validation milestone (M1) ships check 1 only. Checks 2–5 arrive in v0.1.

1. Every validly signed delivery is accepted within the provider's timeout budget.
2. Deliveries with a corrupted signature, a wrong secret or a missing header are **rejected with 4xx**. Accepting one is a security failure. A 5xx counts as a separate failure.
3. Replayed events outside the signature tolerance window are rejected.
4. **Raw-body integrity probe:** valid events containing non-ASCII text, escaped slashes and unusual key order and whitespace are accepted. A rejection means the app verifies a re-serialized body.
5. A delivery signed with the previous secret during rotation is handled as the provider documents.

## 11. Chaos operators

**M1 (first validation milestone):** `duplicate`, `reorder`, `delay`, `concurrent` (concurrent retries of the same event). The contracts must accommodate everything below without breaking changes.

**v0.1:** `semanticDuplicate`, `reorder`, `delay`, `concurrent`, `retryOn5xx` (follows the provider's retry profile), `lostAck`, `timeout`, `corruptSignature`, `wrongSecret`, `staleTimestamp`, `replayOld`, `mutateField` (omit, add or change a field by path), `clockSkew`, `crossTenant` (mix customer or subscription IDs), `staleAfterTerminal` (deliver an older state after a newer terminal state), `amountMismatch`, `currencyMismatch`.

Operators are pure, composable and applied in declared order. Each operator documents the real-world failure it models and links to the provider documentation.

## 12. Lifecycle packs

**M1 built-in scenarios:**

| Scenario name | Provider | Flow |
|---|---|---|
| `stripe-subscription-renewal` | Stripe | Renewal (`invoice.paid`, `customer.subscription.updated`) with duplicate, reorder and concurrent chaos. **This is the M1 demonstration.** |
| `stripe-cancellation-out-of-order` | Stripe | An older cancellation delivered after a newer renewal |
| `stripe-one-time-payment` | Stripe | `payment_intent.succeeded` / `checkout.session.completed` with duplicates |
| `razorpay-subscription-charged` | Razorpay | `subscription.charged` with duplicates and concurrent retries |
| `razorpay-payment-captured` | Razorpay | `payment.captured` with `order.paid`, out of order |
| `generic-hmac-duplicate` | Generic HMAC | User-supplied event payloads, signed with a configured HMAC format, delivered with duplicate, reorder and concurrent chaos |

The generic HMAC adapter is not a provider integration. It signs payloads that the developer supplies, using a configurable format: header name, algorithm (SHA-256, SHA-1, SHA-512), encoding (hex, base64), prefix (such as `sha256=`) and signed-content template (such as `{body}` or `{id}.{timestamp}.{body}`). It ships presets for raw-body hex and Standard Webhooks.

**v0.1 lifecycle packs:** Stripe and Razorpay each provide, where the provider supports it: one-time payment succeeded; payment failed then succeeded; subscription created; renewal; renewal failed then recovered; cancellation (immediate and at period end); refund (full and partial); duplicate success; cancellation and renewal out of order.

**Fixture provenance:** prefer shapes recorded from the provider's real sandbox (Stripe CLI `stripe trigger`, Razorpay test mode), then sanitize and parameterize them. Every fixture records `provider`, `apiVersion`, `source` (`recorded` or `synthesized`) and `recordedAt`. Synthesized shapes must be validated against the provider's official types or OpenAPI spec in tests.

## 13. Outputs

- **Terminal:** a readable timeline (delivery number, event type, event ID, attempt, status code, latency, chaos tags) followed by assertion results. Example failure:

  ```text
  PAYMENTCHAOS FAILED  seed=1337  plan=7f3a…  repeat 4/20 failed

  ✗ Duplicate invoice.paid delivery created two entitlement records.
      expected: 1
      observed: 2
      reproduce: npx paymentchaos run renewal.yaml --seed 1337 --repeat-index 4
  ```

- **JSON** report with a versioned schema (`schemas/report.v1.json`).
- **JUnit XML** that GitHub, GitLab, Jenkins, CircleCI and Azure DevOps all ingest.
- **HTML:** a single self-contained offline file with no external network requests.
- **Exit codes:** `0` pass, `1` assertion failure, `2` config or usage error, `3` target unreachable, `4` internal error.
- **GitHub Action:** wraps the CLI, uploads reports as artifacts and emits `::error` annotations.

## 14. CLI surface

The M1 workflow that must work end to end:

```bash
paymentchaos run stripe-subscription-renewal
```

`run` accepts a scenario **name** or a **file path**. It resolves a name in this order: a matching file in the project's scenario directory (`paymentchaos/scenarios/<name>.yaml` by default), then the built-in scenarios. Built-in scenarios define the provider, flow and chaos. The project config file `paymentchaos.config.yaml` defines everything specific to the project: target URL per provider, secret environment variable names, `beforeEach` reset hook and assertion command. Scenario files can override any project setting. Unknown names fail with exit code `2` and list the closest matches.

M1 ships `run`, `plan` and `flows`. The other commands below arrive in v0.1.

```text
paymentchaos init                    # scaffold paymentchaos.config.yaml, detect framework, print next steps
paymentchaos run <name|file>…        # run scenarios (globs ok); --seed --repeat --reporter --out --allow-remote-target
paymentchaos plan <file>             # dry-run: print the compiled delivery plan and hash, send nothing
paymentchaos flows [provider]        # list lifecycle packs
paymentchaos capture --port 4242     # local listener that records real sandbox webhooks into sanitized fixtures
paymentchaos sanitize <file>         # sanitize an existing payload with deterministic pseudonymization
paymentchaos verify-signature        # offline signature checker (also powers the free web tools)
```

Sanitization uses **consistent pseudonymization**: the same original ID maps to the same replacement everywhere in a fixture set, so relationships between objects survive.

## 15. Technical stack

- **Runtime:** Node.js **>= 22.12.0** (Node 20 reached end-of-life in April 2026). Develop on Node 24.22.0, pinned in `.node-version` and `.nvmrc`. CI runs the minimum (22.12.0) and the pinned version.
- **Language:** TypeScript **6.0.3** with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. ESM. TypeScript 7 (the native compiler) is deferred because Astro's checker and other API-based tools don't support it yet. Adopt it only through an ADR.
- **Monorepo:** pnpm 12.14.0 workspaces through Corepack (`packageManager` field). pnpm's `minimumReleaseAge` supply-chain guard stays on: never add `minimumReleaseAgeExclude` entries; pick an older version instead. Use Turborepo only if build times justify it.
- **Build:** tsdown (or tsup). **Tests:** Vitest plus fast-check property tests. **Lint/format:** Biome.
- **Validation:** zod 4, generating JSON Schema. **YAML:** `yaml`, keeping source positions so errors point at file:line.
- **HTTP:** `undici`, for control over raw bodies, timeouts, abort and connection reuse.
- **CLI:** a small framework (`citty` or `commander`), `picocolors`, and `@clack/prompts` for `init`.
- **Storage:** v0.1 run history is JSON files under `.paymentchaos/runs/` (gitignored). Defer SQLite until it's needed, and then prefer built-in `node:sqlite` over native add-ons.
- **Releases:** Changesets, npm provenance, and a GitHub Container Registry image at `ghcr.io/paymentchaos/cli`. Standalone binaries come later.
- **Docs and marketing:** a static Astro site in `apps/site`, hosted on **AWS Amplify Hosting** connected to the GitHub repository, with preview deployments for pull requests and the custom domain `paymentchaos.com`. Basic docs live at `paymentchaos.com/docs` (Starlight mounted at that subpath).
- **Waitlist:** **Loops**, through its public form endpoint, with no custom backend. Email address only; clear consent text; double opt-in if Loops supports it; a confirmation message after signup; an exportable subscriber list in Loops. The form must fail visibly and accessibly: never show success unless Loops confirmed the subscription. A privacy page names Loops as the service that stores the email. No analytics or advertising trackers.

## 16. Repository layout

```text
packages/
  core/                @paymentchaos/core              contracts, scenario model, PRNG, plan compiler, operators, executor, assertions
  provider-stripe/     @paymentchaos/provider-stripe
  provider-razorpay/   @paymentchaos/provider-razorpay
  provider-generic/    @paymentchaos/provider-generic  configurable HMAC + Standard Webhooks
  sanitize/            @paymentchaos/sanitize
  report/              @paymentchaos/report            terminal, json, junit, html
  cli/                 paymentchaos                    the `paymentchaos` bin
  github-action/       action.yml + entry
apps/
  site/                Astro Starlight: landing, docs, free tools
examples/
  stripe-express-naive/     deliberately buggy reference app
  stripe-express-correct/   the same app done right
  razorpay-express-naive/ … (later: FastAPI, Rails, Laravel, Go)
schemas/               generated JSON Schemas
docs/adr/              architecture decision records
```

## 17. Testing strategy (the product is a testing tool; its own tests must be exemplary)

1. **Unit tests** for every operator, ID generator, currency helper and signer.
2. **Property tests:** the same seed always produces the same plan hash. `duplicate` never removes a logical event. `reorder` preserves the multiset of deliveries. Encoding is byte-stable.
3. **Oracle tests:** sign with PaymentChaos, then verify with the provider's **official** SDK (`stripe.webhooks.constructEvent`, Razorpay `validateWebhookSignature`, `standardwebhooks`). Corrupted signatures must fail that same official verification.
4. **Golden end-to-end tests:** each `*-naive` example app must **fail** with specific, expected messages, and each `*-correct` app must **pass**, on every OS in CI. This test defines whether the product works.
5. **Snapshot tests** for terminal, JUnit, JSON and HTML output, with timestamps and latencies normalized.
6. **Locale tests:** run the suite with `TZ=Pacific/Kiritimati`, `TZ=America/St_Johns` and `LANG=tr_TR.UTF-8`. The Turkish locale catches case-folding bugs.

## 18. Delivery milestones

Approved milestone checkpoints (the human reviews and signs off): **(1)** core architecture and provider contracts, **(2)** the working end-to-end Stripe demonstration, **(3)** the landing page and validation experience, **(4)** the pre-public repository and release.

- **M0, Foundation:** scaffold, ADRs, frozen contracts, CI matrix, example app skeletons. The repository is **private** on GitHub (`paymentchaos/paymentchaos`). *Gate: checkpoint 1.*
- **M1, Validation milestone (stop here):** Stripe, Razorpay and generic HMAC providers; `duplicate`, `reorder`, `delay` and `concurrent` operators; command-based application-state assertions; deterministic terminal report and exit codes; the `paymentchaos run stripe-subscription-renewal` demonstration catching a real invariant violation in the naive example app; a scripted 30–45 second terminal demo recording; the landing page with the Loops waitlist on AWS Amplify; basic docs. **Do not proceed to v0.1 automatically.** *Gates: checkpoints 2 and 3, then developer validation.*
- **Going public (before or during validation, not gated on v0.1):** the repository becomes public once the prototype works end to end, no credentials or captured private data are committed, the README is accurate, LICENSE, SECURITY.md and CONTRIBUTING.md are ready, the public API and scenario format passed a milestone review, and a pre-public security review passed. *Gate: checkpoint 4.*
- **M2, v0.1 public (requires explicit approval after validation):** remaining operators, built-in checks 2–5, HTTP assertions plus settle, JSON/JUnit/HTML reports, capture and sanitize, GitHub Action, Docker image, full docs, npm publish.
- **M3, next providers:** Paddle Billing, then Lemon Squeezy.
- **M4, mobile subscriptions (separate milestone; substantially different auth and lifecycle models):** Apple App Store Server Notifications v2, Google Play Real-time Developer Notifications.
- **M5, later:** Adyen, then regional providers chosen from recorded user demand (interested teams, access to representative test events, lifecycle complexity, willingness to contribute or pay, contract fit). Do not preselect regional providers. The hosted team product comes after all of this, in a separate repository.

Until external developers have used the prototype, do not add: more providers, AI-generated debugging, hosted webhook capture, user accounts, billing, team dashboards, production event routing, Kubernetes or microservices.

## 19. Working rules for every agent

- Read `AGENTS.md` first. It holds the engineering contract.
- Work only in your assigned worktree and branch, and only on your assigned packages. Changes to `packages/core/src/contracts/**` need an ADR and the orchestrator's approval.
- Small, reviewable pull requests (about 400 changed lines or fewer, excluding fixtures and snapshots) with a changeset. Never push directly to `main`; a local pre-push hook enforces this after the bootstrap commit.
- Definition of done: typecheck, lint and tests pass locally; docs and examples updated; no new runtime dependency without a one-line justification in the PR description; no secrets or real customer data anywhere. Never merge unfinished scaffolding, placeholders or disabled checks.
- When a provider behavior is uncertain, cite the provider's official documentation in a code comment or ADR. If you can't confirm it, stop and ask rather than guessing.
- Prefer boring, explicit code over clever abstractions. The difficult part of this product is the correctness model and the ergonomics of writing scenarios, not infrastructure.
