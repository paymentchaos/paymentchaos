# ADR 0004: Scenario and project config format

Status: Accepted · 2026-10-21

## Context

Developers need to express scenarios ergonomically and check them into their repository, while programmatic users want types. Settings split into two kinds: what a scenario *is* (provider, flow, chaos) and what is *local to a project* (target URLs, secret env var names, reset hooks, assertion commands). Mixing them makes built-in scenarios impossible to ship.

## Decision

Two files, one validated model.

**Scenario** — `paymentchaos/scenarios/<name>.yaml`, or a built-in. YAML for humans plus a typed `defineScenario()` API; both compile to the same zod-validated model. Every file declares `version: 1`. A published JSON Schema (`schemas/scenario.v1.json`) is generated from the zod definitions for editor autocomplete.

**Project config** — `paymentchaos.config.yaml` at the repo root: per-provider `target.url` and `target.secret` (as `${ENV_VAR}`), `hooks.beforeEach`, and the default `assert`. Scenario files may override any of these.

`paymentchaos run <name|file>` resolves a name as: project scenario directory first, then built-ins. Built-in scenarios (for example `stripe-subscription-renewal`) carry provider + flow + chaos but read target and secrets from project config, so the quickstart is `paymentchaos run stripe-subscription-renewal`. An unknown name exits `2` and suggests the closest matches.

YAML is parsed with a library that preserves source positions, so validation errors point at `file:line`.

## Consequences

- Built-in scenarios ship with the CLI and need no project edits beyond config.
- The scenario schema is versioned (`version: 1`); additive fields are minor, removals/renames are breaking and need an ADR.
- `chaos` is an ordered list of operators applied in sequence; order is significant and preserved.
- Secrets never appear in scenario or config files, only env var references (see ADR 0006).
