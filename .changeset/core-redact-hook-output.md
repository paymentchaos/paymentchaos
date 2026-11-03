---
"@paymentchaos/core": patch
---

Failed `beforeEach`/`afterEach` hook errors now decode JSON strings before redacting, like assertion output, so a known signing secret printed with escaped slashes or `\uXXXX` escapes, or written into the hook command, is replaced with `[REDACTED]`.
