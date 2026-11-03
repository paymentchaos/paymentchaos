---
"@paymentchaos/core": patch
---

Honor `delay.byMs` waits longer than 2,147,483,647 ms (about 24.8 days). The executor now sleeps in abortable chunks instead of letting Node clamp the timer to 1 ms, which sent the delayed delivery almost immediately and let the run pass.
