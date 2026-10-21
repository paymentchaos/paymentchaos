---
"@paymentchaos/core": minor
---

Add `runScenario`, the orchestration the CLI consumes: guard the target, run `beforeEach`, compile with a fresh id nonce per repetition, execute, apply built-in check 1 (every validly signed delivery is accepted within the timeout budget) and the command assertion with `settle`, run `afterEach`, and repeat N times with per-repetition failure counting. Returns a contract `RunReport` plus per-repetition outcomes, live `RunEvent`s and caveat notes (a passing concurrent run never claims a race is absent).
