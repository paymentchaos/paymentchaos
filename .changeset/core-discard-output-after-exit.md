---
"@paymentchaos/core": patch
---

A hook or assertion command's output is now exactly what was written before its shell exited. PaymentChaos runs the command through a small launcher on the same Node.js binary. The launcher marks the end of the output in each pipe once the shell has exited. This fixes two problems:

- Output from a background process the command started could be counted for up to 250 ms after the shell exited. A late failing check could then change the verdict.
- When many commands started and exited at once, the command's own final output, including its result document, could be lost.

`NODE_OPTIONS` still reaches the command but not the launcher.
