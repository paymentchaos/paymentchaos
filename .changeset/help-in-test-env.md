---
"paymentchaos": patch
---

Print `--help` and usage text even when `NODE_ENV=test` is set. Previously the help output was silently empty in many CI and test environments.
