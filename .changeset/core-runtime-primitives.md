---
"@paymentchaos/core": minor
---

Add the deterministic runtime primitives: a seeded, versioned sfc32 PRNG with label forks (`createRng`, `PRNG_VERSION`), a provider-shaped id factory with an optional per-run nonce (`createIdFactory`, `createRunNonce`), and a logical clock starting at a fixed UTC epoch (`createLogicalClock`).
