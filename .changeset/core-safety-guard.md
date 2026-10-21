---
"@paymentchaos/core": minor
---

Add the remote-target safety guard (`assertTargetAllowed`, ADR 0006): non-local targets throw `REMOTE_TARGET_BLOCKED` unless the exact host is passed as `allowRemoteTarget`. Add secret helpers for adapters and the executor: `resolveSecret` (throws `SECRET_MISSING` naming only the variable), `secretValues` and `redactSecrets`.
