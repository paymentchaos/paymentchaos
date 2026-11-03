---
"@paymentchaos/core": patch
---

A hook or assertion command's output now ends when its shell exits. PaymentChaos runs the command through a small launcher on the same Node.js binary. The launcher receives the command on stdin and marks the end of the output in each pipe once the shell has exited. This fixes two problems:

- Output from a background process the command started could be counted for up to 250 ms after the shell exited. A late failing check could then change the verdict.
- When many commands started and exited at once, the command's own final output, including its result document, could be lost.

A background write in the same instant the shell exits can still be counted, usually within well under a millisecond and within a few milliseconds on a loaded machine. Each command run costs one extra short-lived Node.js process, about 20 ms. `NODE_OPTIONS` still reaches the command but not the launcher.
