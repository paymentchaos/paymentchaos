---
"@paymentchaos/core": patch
---

A failed `beforeEach` or `afterEach` hook no longer prints its command in the error. Only signing secrets are redacted, so any other credential written into the hook command could leak to stderr and CI logs. The error still names the hook phase, the exit code or timeout, and the hook's redacted stderr.

A hook or assertion command that Node.js refuses to start, for example one containing a NUL byte, now fails with a typed error that gives only Node's error code. Previously, Node's own exception quoted the whole command, signing secret included, and the CLI exited 4. A hook like this now exits 2 as a configuration error.
