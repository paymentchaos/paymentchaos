# PaymentChaos — Multi-Agent Execution Plan

Three agent providers build PaymentChaos in parallel, coordinated from one orchestrator thread in T3 Code. Each work stream runs in its own git worktree and branch and owns a fixed set of packages (see `AGENTS.md`). Every pull request is reviewed by a **different** provider than the one that wrote it.

## 1. Agent roles

| Agent | Model (T3 provider) | Why this agent | Owns |
|---|---|---|---|
| **Claude** | Claude Opus 5.5, high/xhigh effort (`claudeAgent`) | Strongest at architecture, long-context reasoning and subtle correctness models | Foundation, contracts and ADRs; core engine (PRNG, plan compiler, operators, executor, assertions); integration; release |
| **Codex** | GPT-6.1-Sol, high effort (ChatGPT instance) | Precise, spec-driven protocol and crypto work; strong adversarial reviewer | Provider adapters (Stripe, Razorpay, generic HMAC, Standard Webhooks); signing and oracle tests; currency module; sanitize and capture; security review |
| **Cursor** | Composer 2.5 for builds; GPT-5.6/Gemini for second opinions (`cursor`) | Fastest iteration on UI-heavy, many-file surfaces | CLI UX, terminal/JSON/JUnit/HTML reports, GitHub Action, example apps, Astro site, demo recording |
| **Orchestrator** | This thread | — | Sequencing, merges, lockfile and CI, conflict resolution, milestone gates with you |

### Review rotation

| Author | Primary reviewer | Focus |
|---|---|---|
| Claude (core) | Codex | Break determinism, find races in the executor, find operator edge cases |
| Codex (providers) | Claude | Provider-spec accuracy, contract conformance, global money and time handling |
| Cursor (CLI/reports/examples/site) | Claude | UX consistency, error messages, contract usage; Codex for the GitHub Action and Docker security |
| Anyone touching `contracts/` | Claude **and** Codex | Breaking-change analysis |

Reviews run as delegated T3 tasks, one `delegate_task` call per review round. Each round's prompt carries the prior findings and the author's responses.

## 2. Phase plan

```text
M0 Foundation ──► [CHECKPOINT 1: contracts] ──► M1 parallel build ──► integration
      ──► [CHECKPOINT 2: Stripe demo] ──► [CHECKPOINT 3: landing page] ──► STOP: validation
      ──► [CHECKPOINT 4: pre-public review ──► repo goes public]
      ──► (only with explicit approval) M2 v0.1 ──► launch
```

Human-approved checkpoints replace per-PR human review. Between checkpoints: at least one independent agent review per PR, tests and smoke scenarios green, the integration owner (orchestrator) merges. Contract changes, security-sensitive changes and destructive migrations always go to the human. The repository is **private** until the going-public checklist in `BUILD_PROMPT.md` §18 is met; do not wait for a feature-heavy v0.1 to open-source it.

### M0 — Foundation (sequential, Claude only)

Nothing runs in parallel until the contracts are frozen. Otherwise three agents invent three incompatible models.

1. Monorepo scaffold: pnpm workspaces, TypeScript config, Biome, Vitest, Changesets, `.gitattributes`, `.editorconfig`, Apache-2.0 `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`.
2. CI: GitHub Actions matrix (Ubuntu, macOS, Windows × Node 22 and 24) running typecheck, lint and test.
3. ADRs 0001–0007: package layout; signing model (`SignedDelivery`, `SigningKeySet` with rotation); determinism (PRNG choice, plan hash, run nonce); scenario schema v1; assertion protocol (command JSON, HTTP expectations, settle); safety guard (remote-target policy, secret redaction); money and time conventions.
4. `packages/core/src/contracts/**`: all public types and zod schemas, plus generated `schemas/scenario.v1.json` and `schemas/report.v1.json`.
5. Empty package shells with `index.ts`, plus example app skeletons.
6. **Review:** Codex adversarially reviews the contracts and ADRs. Claude resolves the findings.
7. **Gate: checkpoint 1.** You approve the contracts. After this, they change only through an ADR.

### M1 — Validation milestone (parallel, six worktrees)

Scope per your decision: monorepo and contracts (done in M0); Stripe, Razorpay and generic HMAC providers; duplicate, out-of-order, delay and concurrent-retry simulation; command-based state assertions; deterministic terminal report and exit codes; one complete end-to-end demonstration (`paymentchaos run stripe-subscription-renewal`); landing page with waitlist; basic docs. **No other providers, no hosted anything, no accounts, no billing.**

| Stream | Agent | Branch | Deliverable |
|---|---|---|---|
| A. Core engine | Claude | `m1/core-engine` | PRNG, ID generator, plan compiler, `duplicate`/`reorder`/`delay`/`concurrent`, undici executor with barrier release, command assertion plus settle, `repeat` |
| B. Stripe provider | Codex | `m1/provider-stripe` | Currency module; Stripe adapter (renewal, cancellation-out-of-order, one-time payment); `t=,v1=` signer with rotation; `verify`; oracle tests against the official `stripe` SDK |
| C. Razorpay + generic HMAC | Codex | `m1/provider-razorpay` | Razorpay adapter (`subscription.charged`, `payment.captured`/`order.paid`) with oracle tests against Razorpay's official SDK; generic HMAC adapter with configurable format and Standard Webhooks preset. Starts after B's currency module merges. |
| D. CLI and terminal report | Cursor | `m1/cli` | `run` (name or file resolution), `plan`, `flows`; `paymentchaos.config.yaml`; YAML errors with file:line; terminal timeline reporter; exit codes; built against contract fakes until A and B merge |
| E. Examples and golden end-to-end | Cursor | `m1/examples` | `stripe-express-naive` (four documented bugs) and `stripe-express-correct`; verification scripts; golden end-to-end harness |
| F. Landing page + basic docs | Cursor | `m1/site` | Astro landing page for paymentchaos.com on AWS Amplify: problem, three failure scenarios, demo slot, install snippet, Loops waitlist (visible accessible failure states, consent text, privacy note naming Loops); basic docs under `/docs` |

**Merge order:** B (currency first) → A → C → D → E. The orchestrator then runs the golden end-to-end tests and records the 30–45 second demo with a `vhs` tape script, which goes into F.

**Gates:** checkpoint 2 (you watch the demo), checkpoint 3 (landing page and validation experience). Then **stop**: you run validation with real developers. v0.1 needs your explicit approval.

### Going public (checkpoint 4)

A fresh Codex session runs the pre-public security review (secret leakage, remote-target guard, command injection, report XSS, supply chain, no credentials or captured data in history). You review, then the repository flips to public for developer validation.

### M2 — v0.1 public (only after validation and your explicit approval)

| Stream | Agent | Deliverable |
|---|---|---|
| Core completion | Claude | Remaining operators (`semanticDuplicate`, `timeout`, `retryOn5xx`, `corruptSignature`, `wrongSecret`, `staleTimestamp`, `replayOld`, `mutateField`, `clockSkew`, `crossTenant`, `staleAfterTerminal`, `amountMismatch`, `currencyMismatch`); built-in checks 2–5, including the raw-body integrity probe; HTTP JSON assertions; race-repeat reporting; JSON run history |
| Providers | Codex | `sanitize` package with consistent pseudonymization and global PII rules; `capture` listener; `verify-signature` |
| Surfaces | Cursor | JSON, JUnit and self-contained HTML reporters; `init` command; GitHub Action; Docker image; full docs site; free web tools (Stripe and Razorpay signature verifiers, event-order visualizer) |
| Examples | Cursor | Razorpay naive/correct; one non-Node example (FastAPI) to prove the tool is language-agnostic |
| Release | Claude | Changesets, npm provenance, GHCR image, `v0.1.0` tag, release notes |

### M3+ provider roadmap (decided)

1. **M3:** Paddle Billing, then Lemon Squeezy (independent developers and SaaS).
2. **M4, separate milestone:** Apple App Store Server Notifications v2 and Google Play RTDN (substantially different auth, payload and lifecycle models).
3. **M5:** Adyen, then regional providers **selected from recorded demand only** (interested teams, access to representative test events, lifecycle complexity, willingness to contribute or pay, contract fit). Mollie, Mercado Pago, Paystack and Xendit are not preselected. Track requests in a `docs/provider-demand.md` tally.

## 3. How sessions are launched in T3

- **Build streams** are top-level threads created with `t3_thread_launch` and `workspaceStrategy: { type: "worktree", baseRef: "main", branch: "<branch>", startFromOrigin: false }`. You can watch any of them and talk to it directly.
- **Reviews** run as `delegate_task` child tasks from the orchestrator, one per round, each with a stable `clientRequestId`.
- The orchestrator polls with `t3_thread_wait` and merges in the order above. If two streams need the same file, the orchestrator decides; agents never resolve cross-stream conflicts themselves.

## 4. Task prompts

Every build session starts with this preamble:

> You are working on PaymentChaos. Read `AGENTS.md`, `docs/plan/BUILD_PROMPT.md` and the ADRs in `docs/adr/` before writing code. You are in a dedicated worktree on branch `<branch>`. Change only the packages your stream owns. Contracts in `packages/core/src/contracts/` are frozen. If you need a contract change, write a proposed ADR in your PR and stop. Open small PRs against `main` with changesets. When provider behavior is uncertain, cite official docs or ask; do not guess.

### M0 — Claude (Foundation)

> Build Milestone M0 exactly as described in `docs/plan/MULTI_AGENT_PLAN.md` §2 and `BUILD_PROMPT.md` §§6–9, 15–16. Produce the monorepo scaffold, CI matrix, ADRs 0001–0007, and the complete `packages/core/src/contracts/**` with zod schemas and generated JSON Schemas. The `ProviderAdapter` interface in BUILD_PROMPT §8 is indicative; refine it so it supports all five signing schemes without breaking changes, and document the result in ADR-0002. Write type-level tests that a fake provider and a fake operator can implement the contracts. Do not implement engine logic. Finish with a summary of every open decision that needs human approval.

### M1-A — Claude (Core engine)

> Implement the M1 core engine in `packages/core` against the frozen contracts: seeded PRNG, provider-shaped ID generation with run nonce, plan compiler and plan hash, operators `duplicate`, `reorder`, `concurrent`, `delay`, `lostAck`, an undici executor that releases concurrent groups behind a barrier and records exact timings, the command assertion protocol with `settle` polling, and `repeat`. Property-test determinism (same seed produces the same plan hash) and operator invariants with fast-check. Never use wall-clock time or `Math.random` in planning. Use a fake provider in tests; the Stripe adapter is being built in parallel.

### M1-B — Codex (Stripe provider and currency)

> Implement `packages/core/src/money` (ISO 4217 exponent table including zero- and three-decimal currencies; helpers for minor units) and `packages/provider-stripe`. Lifecycle packs: `one-time-payment`, `subscription-renewal`, `cancellation-renewal-out-of-order`, parameterized by currency, country and API version. Encode exact bytes, including non-ASCII customer data. Implement Stripe's `t=…,v1=…` signing, including multiple `v1` signatures during secret rotation and timestamp tolerance, and `verify`/`identify`. Oracle-test every signature against `stripe.webhooks.constructEvent`, both valid and corrupted. Record fixture provenance. Cite Stripe docs for every behavior you encode.

### M1-C — Cursor (CLI and terminal report)

> Implement `packages/cli` (`paymentchaos run|plan|flows`) and the terminal reporter in `packages/report`. Load YAML with source positions so validation errors show file:line and a fix hint. Implement the exit codes and terminal output format in BUILD_PROMPT §13 exactly, including the reproduce command with seed. Enforce the remote-target safety guard. Keep all strings in a messages module. Build against contract-conforming fakes so you aren't blocked by the core and Stripe streams. Snapshot-test output with normalized timings. Verify that it works on Windows paths and shells.

### M1-D — Cursor (Examples and golden end-to-end)

> Create `examples/stripe-express-naive` and `examples/stripe-express-correct`: a small Express and SQLite subscription app with a `/__test__/state` endpoint and a `verify` script. The naive app must contain exactly these documented bugs: (1) no idempotency on event ID, (2) a non-atomic check-then-insert idempotency race, (3) an older cancellation revoking a newer active subscription, (4) signature verification against a re-serialized body. The correct app fixes all four. Write the golden end-to-end test so that naive fails with specific expected messages and correct passes. Write a README for each explaining the bugs; these become launch content.

### M1-E — Cursor (Landing page)

> Build `apps/site` with Astro (Starlight-ready for docs later) for paymentchaos.com. Sections: headline "Break your payment integration before production does"; the problem with three concrete failure stories (duplicate grant, stale cancellation, concurrent retry); a terminal demo slot; install snippet; how it differs from capture-and-replay tools, worded factually and respectfully; waitlist form for team features; GitHub link. Global audience: no region-specific assumptions, accessible (WCAG AA), fast (no client framework unless needed), no third-party trackers.

## 5. Prerequisites

- [x] Node 24.22.0, pnpm 12.14.0 (Corepack) and GitHub CLI 2.102.1 installed under `~/.local` (no sudo, no system packages touched).
- [x] Monorepo bootstrap committed: workspace config, TypeScript, Biome, Vitest, Changesets, CI matrix, LICENSE, SECURITY.md, CONTRIBUTING.md, plan docs, ADRs. Typecheck, lint and tests green.
- [x] Scope, GitHub, tooling, review, provider order and landing/waitlist decisions recorded (see ADRs and §2).
- [ ] **You:** run `gh auth login`. If creating the `paymentchaos` org needs a browser step, the orchestrator will flag it.
- [ ] **Orchestrator:** create the private repo `paymentchaos/paymentchaos`, set the remote, push the bootstrap, enable the CI workflow.
- [ ] npm org `@paymentchaos` reserved and the unscoped `paymentchaos` name claimed (both currently free; reserve at publish time, kept private until then).
- [ ] **Checkpoint 1:** you approve the contracts and ADRs before M1 parallel work merges.
