---
"@paymentchaos/core": minor
---

`runScenario` accepts `repeatIndex` to run exactly one repetition of `repeat` (for `--repeat-index`). Only that repetition is compiled, hooked, sent and asserted. Hooks, the assertion command (`PAYMENTCHAOS_REPEAT_INDEX`), `RepeatOutcome.index` and `RunEvent`s all carry the selected index. The report's `repeat` and `repeatsFailed` count only executed repetitions, and a note explains that replaying concurrent deliveries may not reproduce the original outcome. An index that isn't a whole number from 1 to the repeat count fails with `CONFIG_INVALID` before any hook or send. `repeat` is now validated before the signing secret.
