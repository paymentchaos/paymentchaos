---
"paymentchaos": minor
"@paymentchaos/report": patch
---

Wire the CLI to `@paymentchaos/core` (`compilePlan`, `runScenario`) via an installed-provider registry, ship `@paymentchaos/provider-stripe` as a dependency so Stripe scenarios work out of the box, remove the production fake engine, fix built-in cancellation reorder and YAML line numbers, validate numeric flags, surface run notes in the terminal reporter, add `--timeout-ms`, forward `--repeat-index` to core, and include `--repeat N` in reproduce output when replaying a selected repetition.
