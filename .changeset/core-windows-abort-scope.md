---
"@paymentchaos/core": patch
---

On Windows, an interrupted or timed-out hook or assertion command is now killed with a `taskkill` that finishes before the run continues or exits. Windows has no process groups, so after a command's shell has exited, an interrupt no longer reaches processes it left in the background. PaymentChaos no longer calls `taskkill` on a process ID that has already exited, which could have been reused by an unrelated process. On macOS and Linux, background processes are still killed through the command's process group.
