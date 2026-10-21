---
"@paymentchaos/core": minor
---

Add the undici executor (`executePlan`): enforces the remote-target guard and checks the signing secret before any send, signs each attempt with a fresh timestamp over the plan's exact body bytes, releases each concurrency group together behind a barrier, honours delay offsets scaled by `timeScale`, and records status, latency, attempt, errors and acceptance per delivery. An unreachable target raises `TARGET_UNREACHABLE`; signing errors are redacted. Adds `startRecordingServer` to `@paymentchaos/core/testing`.
