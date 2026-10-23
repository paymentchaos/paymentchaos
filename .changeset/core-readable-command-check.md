---
"@paymentchaos/core": patch
---

Name the command-assertion verdict `assert.command exits 0` instead of echoing the full shell command, which the terminal truncated into an unreadable fragment and which could carry a secret into reports.
