---
---

Add a private testing sandbox to the golden examples (`pnpm --filter @paymentchaos/golden-e2e sandbox <dir>`). It runs 63 cases against the built CLI, using official-SDK webhook verification, deliberately broken handlers and per-case logs, and needs no real payment accounts.

Timed-out runs clean up assertion and hook descendants before continuing, and saved command logs redact both the default and overridden sandbox signing keys.
