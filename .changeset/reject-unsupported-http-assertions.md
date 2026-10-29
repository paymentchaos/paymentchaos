---
"@paymentchaos/core": patch
"paymentchaos": patch
---

Reject unsupported HTTP assertions before running hooks or sending webhooks, instead of
skipping the requested check and potentially reporting success. Use command assertions
until HTTP assertions are implemented.
