---
"@paymentchaos/core": minor
---

Add the plan compiler (`compilePlan`): validated scenario + provider adapter → deterministic `DeliveryPlan` with a stable SHA-256 `planHash` over the normalized plan (deliveries, attempts, groups, offsets, tags and body digests). The run nonce is stripped before hashing, so the same seed, scenario and engine version always give the same hash. Rejects unknown flows and API versions, and adapters whose `encode` is not byte-stable.
