---
"@paymentchaos/golden-e2e": minor
---

Add `demo:ci --out /absolute/dir` to produce four JSON/JUnit reports from the built CLI against the Stripe naive and correct examples for portable CI artifact uploads. It refuses non-empty output directories and unexpected arguments, keeps CLI stderr separate from the report stdout, reports time limits as timeouts, and checks both streams for the signing secret before showing diagnostics.
