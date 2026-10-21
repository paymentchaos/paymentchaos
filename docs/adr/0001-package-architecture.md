# ADR 0001: Monorepo and package architecture

Status: Accepted · 2026-10-21

## Context

PaymentChaos is one product made of a reusable engine, several provider adapters, output formatters, a CLI and a docs site. Provider adapters must be publishable and versionable on their own so the engine can evolve without forcing every adapter to re-release. The tool must also run against applications written in any language, so the user-facing artifact is a CLI and a Docker image, not a library the target app imports.

## Decision

A pnpm-workspace monorepo. Published packages are scoped `@paymentchaos/*`, except the CLI, which owns the unscoped bin name `paymentchaos`.

```text
packages/core        @paymentchaos/core       contracts, scenario model, PRNG, plan compiler, operators, executor, assertions
packages/provider-*  @paymentchaos/provider-* one package per provider; depends only on core
packages/report      @paymentchaos/report     terminal/json/junit/html reporters
packages/sanitize    @paymentchaos/sanitize   capture redaction (v0.1)
packages/cli         paymentchaos             the bin; wires providers + reporters
packages/github-action                        Action wrapping the CLI (v0.1)
apps/site                                      Astro landing + docs
examples/*                                     reference target apps for golden e2e tests
```

Dependency rule: adapters and reporters depend on `core` only. `core` depends on no other workspace package and never imports a provider. The CLI is the only package that composes providers and reporters. This keeps `core`'s contracts the single integration point.

## Consequences

- Public contracts live in `@paymentchaos/core` and are frozen (see ADR 0002–0007). Breaking them is a major version bump and needs an ADR.
- Internal workspace deps use `workspace:*`; Changesets rewrites them on publish.
- The target application never installs a PaymentChaos package; it only receives HTTP requests. That keeps the tool language-agnostic.
- Turborepo is not adopted yet; plain `pnpm -r` is enough at this size. Revisit if build time demands it.
