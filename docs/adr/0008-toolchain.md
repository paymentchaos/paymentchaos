# ADR 0008: Toolchain and versions

Status: Accepted · 2026-10-21

## Context

The project pins its toolchain so every agent and every CI runner builds identically, and so a supply-chain incident in a fresh release can't silently enter the tree.

## Decision

- **Node.js:** develop on 24.22.0 (pinned in `.node-version`, `.nvmrc`); support `>=22.12.0` (`package.json#engines`). Node 20 is end-of-life. CI runs 22.12.0 and 24.22.0 on Ubuntu and Windows; macOS runs on main and on PRs labelled `ci:full` to control private-repo macOS minutes.
- **pnpm:** 12.14.0 via Corepack (`packageManager`). pnpm's `minimumReleaseAge` supply-chain guard stays enabled; never add `minimumReleaseAgeExclude` entries — pick an older, already-aged version instead. (This is why Biome is pinned to 2.5.15, not the same-day 2.6.0 release.)
- **TypeScript:** 6.0.3, workspace-wide, with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. ESM only. **Not** TypeScript 7 yet: Astro's `@astrojs/check` and other API-based tools peer-depend on TS 5/6. Adopting TS 7 needs its own ADR once the ecosystem catches up.
- **Lint/format:** Biome 2.5.15 (two-space indent, 100 cols). Fixtures and `pnpm-lock.yaml` are excluded so formatting never rewrites signed bytes.
- **Tests:** Vitest 5 plus fast-check (property tests).
- **Releases:** Changesets; npm provenance and a GHCR image at publish time.
- **Local branch protection:** a `.githooks/pre-push` hook blocks direct pushes to `main` (free private repos can't enforce server-side branch protection). The one-time bootstrap push uses `PAYMENTCHAOS_ALLOW_MAIN_PUSH=1`.

## Consequences

- A repo test (`tooling/repo.test.ts`) asserts the Node/pnpm pins stay consistent across `.node-version`, `.nvmrc`, `package.json`, the README and CI.
- Dependency bumps are deliberate; the release-age guard adds latency by design.
- Revisiting TS 7 or Turborepo each requires a superseding ADR.
