---
"@paymentchaos/core": patch
---

A hook or assertion command's output is now only what it wrote before its shell exited. Previously, output from a background process it started could still be counted for 250 ms afterwards, so a late failing check could flip a passing verdict depending on timing. Commands also finish up to 250 ms sooner when they leave a process running.
