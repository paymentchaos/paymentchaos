---
"@paymentchaos/core": minor
---

`DeliveryProfile.timeoutMillis` and `retryScheduleMillis` now accept `null` for provider timing the provider does not publish; `[]` still means "documents no automatic retries" (ADR 0009). The executor no longer uses the adapter's profile timeout as its request budget: requests get PaymentChaos's local timeout, `DEFAULT_REQUEST_TIMEOUT_MS` (10 000 ms), or the caller's `timeoutMillis`, now also accepted by `runScenario`. An invalid timeout (not an integer from 1 to 2147483647) fails with `CONFIG_INVALID` before secrets, hooks or sends. `createFakeProvider` now defaults its profile `timeoutMillis` to `null`.
