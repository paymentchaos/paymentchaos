# AGENTS.md — PaymentChaos engineering contract

This file is read by every coding agent (Claude, Codex, Cursor) and every human contributor. Read it before touching code.

- Product spec and the full build prompt: `docs/plan/BUILD_PROMPT.md`
- Who works on what, and when: `docs/plan/MULTI_AGENT_PLAN.md`
- Decisions that override the spec: `docs/adr/`

## What PaymentChaos is

An open-source, local-first CLI and TypeScript library that sends provider-accurate, correctly signed webhook deliveries to a developer's app under deterministic chaos (duplicates, reordering, concurrency, retries, bad signatures, stale state), then asserts on the app's **business state**. It runs against backends written in any language, on macOS, Linux and Windows.

It is not a gateway, tunnel, request bin, API client, load tester or AI reviewer.

## Commands

```bash
pnpm install
pnpm build          # all packages
pnpm typecheck
pnpm lint           # biome check
pnpm test           # vitest (unit + property + oracle)
pnpm test:e2e       # golden end-to-end tests against examples/*
pnpm changeset      # every user-visible change needs one
```

Requires Node >= 22 (develop on Node 24) and pnpm via corepack.

## Package ownership

Change only the packages your task assigns to you. If you need a change elsewhere, say so in your PR description and leave the change out.

| Path | Owner stream |
|---|---|
| `packages/core/src/contracts/**` | **Frozen.** Change only through an ADR approved by the orchestrator. |
| `packages/core/**` (rest) | Core engine stream |
| `packages/core/src/money/**` | Provider stream |
| `packages/provider-*/**`, `packages/sanitize/**` | Provider stream |
| `packages/cli/**`, `packages/report/**`, `packages/github-action/**` | CLI/report stream |
| `examples/**` | Examples stream |
| `apps/site/**` | Site stream |
| root config, CI, lockfile, `schemas/**` | Orchestrator only; the orchestrator regenerates the lockfile on merge |

## Non-negotiable rules

1. **Raw bytes.** Webhook bodies are `Buffer` from generation to wire. Never `JSON.parse` then `JSON.stringify` a body that will be signed or compared. Fixtures are protected from line-ending conversion by `.gitattributes`.
2. **Determinism.** No `Math.random()`, `Date.now()` or `new Date()` in planning code. Use the injected seeded PRNG and logical clock. Seed plus scenario plus version must produce an identical plan hash.
3. **Money.** Integer minor units plus an ISO 4217 code. Use the shared currency-exponent table. No floats for amounts.
4. **Time.** UTC internally and in machine output. Each provider adapter owns its timestamp format.
5. **Safety.** Non-local targets require `--allow-remote-target <host>`. Never log, print or report a secret. Generated events are always marked as test or sandbox.
6. **Portability.** No native add-ons in the CLI install path. Use `node:path`. Every feature works on Windows; CI proves it.
7. **No telemetry.** No network calls except to the user's configured target.
8. **Provider facts need sources.** Cite official provider documentation in a comment or ADR for every signing, retry, ordering or timeout behavior. If unsure, stop and ask.
9. **User-facing strings** live in the messages module of their package, never inline. This keeps i18n possible later.
10. **Dependencies.** Every new runtime dependency needs a one-line justification in the PR. Prefer the Node standard library.

## Code style

- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. ESM only.
- Biome formats and lints; don't hand-format.
- Errors are typed (`PaymentChaosError` with a stable `code`). User-facing errors say what happened, where (file:line for config) and how to fix it.
- Keep public types in `contracts`. Export narrowly from each package's `index.ts`.
- Comments explain constraints the code can't express (for example, a provider quirk with a docs link). Don't narrate the code.

## Tests

- Every chaos operator: unit tests plus fast-check property tests.
- Every signer: oracle test against the provider's official SDK verification function, covering both pass and corrupted-fail cases.
- Golden end-to-end: `examples/*-naive` must fail with the expected messages, and `examples/*-correct` must pass.
- Report formats: snapshot tests with timestamps and latencies normalized.
- Use non-ASCII, multi-currency fixtures (include JPY, INR and BHD at least).

## Pull requests

- One logical change, about 400 changed lines or fewer (fixtures and snapshots excluded), with a changeset.
- Title format `<package>: <imperative summary>`.
- The description covers what changed, why, how it was tested and any open questions.
- A reviewer from a **different** agent provider than the author must approve it (see the review rotation in `docs/plan/MULTI_AGENT_PLAN.md`).
- Definition of done: `pnpm typecheck && pnpm lint && pnpm test` pass, docs updated, no secrets or real customer data.
