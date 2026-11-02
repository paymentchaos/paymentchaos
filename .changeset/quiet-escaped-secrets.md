---
"@paymentchaos/core": patch
---

Redact known signing secrets inside JSON-escaped assertion output before parsing checks or retaining diagnostic tails, preventing escaped values and object keys from reaching reports.
