---
"paymentchaos": patch
"@paymentchaos/report": patch
"@paymentchaos/golden-e2e": patch
---

Print the terminal report's `reproduce:` command once per failed run, after the assertions, and drop `--repeat-index` and the `repeat 1/1 failed` banner suffix when the run had a single repetition. Cap long assertion names (such as the full assertion command) at 80 characters in the terminal only. The CLI now sets `process.exitCode` instead of calling `process.exit()`, so piped output is never truncated, and maps usage errors to exit 2 and unexpected errors to exit 4 through a single error boundary. The golden e2e harness quotes the assertion command per platform (POSIX single quotes; cmd.exe double quotes, refusing `"`, `%` and line breaks).
