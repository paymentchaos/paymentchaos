---
"@paymentchaos/core": patch
---

Treat a hook or assertion command as finished when its shell exits. A process it leaves in the background (`npm start &`) no longer holds the run until the 120-second command timeout. It keeps running for the rest of the run, and its later output is drained and discarded. Aborting the run still kills the command's process group, including background processes that hold its output open.
