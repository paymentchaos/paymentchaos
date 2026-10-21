---
"@paymentchaos/core": minor
---

Add the command-assertion runner (ADR 0005): `runCommandAssertion` runs the command through the platform shell with an allowlisted environment plus `PAYMENTCHAOS_RUN_ID`, `PAYMENTCHAOS_SEED`, `PAYMENTCHAOS_PLAN_HASH`, `PAYMENTCHAOS_REPEAT_INDEX`, `PAYMENTCHAOS_IDS_JSON` and `PAYMENTCHAOS_ID_<NAME>` (parent secrets are never passed through), treats exit 0 as pass, parses the optional JSON result document (tolerating `npm run` banners), supports `settle` polling, kills the process tree on timeout and redacts secrets from captured output.
