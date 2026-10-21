# ADR 0003: Determinism, PRNG and plan hash

Status: Accepted · 2026-10-21

## Context

PaymentChaos must be reproducible: the same scenario and seed must produce the same deliveries, so a failure a developer sees locally reproduces in CI and vice versa. At the same time, it is a concurrency testing tool, and real race conditions are inherently nondeterministic on the target side. The model must be honest about which half is deterministic.

## Decision

**Deterministic half — planning.** A run has a seed (random by default, always printed, overridable with `--seed`). Seed + scenario file + PaymentChaos version compile to a byte-identical **delivery plan** with a stable **plan hash**. Planning code must not call `Math.random()`, `Date.now()` or `new Date()`; it uses an injected seeded PRNG and a logical clock. The PRNG is a self-contained, versioned algorithm (sfc32 or xoshiro128\*\*), not the platform RNG, so results match across Node versions and OSes.

Provider-shaped IDs (`evt_…`, `cus_…`, `sub_…`, `in_…`, `pay_…`, `order_…`) are derived from the seeded PRNG plus a per-run nonce, so repeated runs against a persistent database don't collide. `--stable-ids` disables the nonce for golden snapshots.

**Nondeterministic half — execution.** The dispatch order of deliveries is deterministic, but the target server's interleaving of concurrent deliveries is not. Concurrent groups are released together behind a barrier. To surface races, scenarios support `repeat: N`; the report states how many repetitions failed. PaymentChaos never claims a passing concurrency run proves the absence of a race.

Delays are real wall-clock time on the wire, scaled by a `timeScale` so a three-day retry schedule can run in seconds.

## Consequences

- The plan hash is a first-class output, shown in reports and usable in assertions/CI to detect unintended plan drift.
- `paymentchaos plan <scenario>` prints the compiled plan and hash and sends nothing.
- Property tests assert: same seed → same plan hash; `duplicate` never drops a logical event; `reorder` preserves the delivery multiset; `encode` is byte-stable.
- The PRNG algorithm and ID-derivation scheme are part of the frozen contract; changing them changes every plan hash and is a breaking change.
