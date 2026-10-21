---
"@paymentchaos/core": minor
---

Add `@paymentchaos/core/testing` with a contract-conforming fake provider (deterministic UTF-8 bodies, HMAC `t=,v1=` signing with rotation-aware `verify`) so engine and CLI tests don't depend on a real provider adapter.
