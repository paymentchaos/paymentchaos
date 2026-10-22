---
"@paymentchaos/golden-e2e": patch
"@paymentchaos/example-stripe-express-naive": patch
"@paymentchaos/example-stripe-express-correct": patch
---

Wire golden end-to-end tests to real core execution and HTTP targets, add cancellation and concurrency coverage, explicit verify `--base-url`, a local `demo` command for checkpoint 2 recordings, and golden tests that run the real `paymentchaos run stripe-subscription-renewal` CLI against both examples (naive fails, correct passes).
