---
"paymentchaos": patch
---

Stop a run cleanly on Ctrl-C (SIGINT) or SIGTERM. The CLI now aborts the run, which kills the running hook or assertion command and everything it started, prints `Interrupted by <signal>` to stderr, and then ends by that signal. Before, those commands ran on in their own process group after the CLI died.
