---
"@paymentchaos/core": patch
---

The executor's `timeoutMillis` is now the only deadline on each request. Before, undici's default 300-second header and body timeouts (or an injected dispatcher's own timeouts) could cut short a local timeout set longer than that. Each request now sets `headersTimeout: 0` and `bodyTimeout: 0`, including on an injected `dispatcher`.
