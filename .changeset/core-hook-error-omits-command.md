---
"@paymentchaos/core": patch
---

A failed `beforeEach` or `afterEach` hook no longer prints its command in the error. Only signing secrets are redacted, so any other credential written into the hook command could leak to stderr and CI logs. The error still names the hook phase, the exit code or timeout, and the hook's redacted stderr.
