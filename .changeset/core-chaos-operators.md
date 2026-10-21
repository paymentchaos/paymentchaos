---
"@paymentchaos/core": minor
---

Add the M1 chaos operators `duplicate` (redelivery: same event id and bytes), `reorder`, `delay` and `concurrent` as pure `(plan, rng, params) => plan` functions, an operator registry with `applyChaos` (declared order, per-operator RNG streams), and plan-draft normalization.
