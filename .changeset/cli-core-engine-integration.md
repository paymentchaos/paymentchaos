---
"paymentchaos": minor
"@paymentchaos/report": patch
---

Wire the CLI to `@paymentchaos/core` (`compilePlan`, `runScenario`) via an installed-provider registry, remove the production fake engine, fix built-in cancellation reorder and YAML line numbers, validate numeric flags, and surface run notes in the terminal reporter.
