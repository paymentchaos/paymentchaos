# ADR 0005: Assertion protocol

Status: Accepted · 2026-10-21

## Context

HTTP responses do not prove business correctness: an endpoint can return `200` and still have granted an entitlement twice. The tool's core value is asserting on the developer's *application state*. Many real apps acknowledge a webhook quickly and process it asynchronously, so assertions must tolerate a settling delay. Assertions must also work regardless of the app's language.

## Decision

Two assertion mechanisms, both language-agnostic.

**Command assertion (M1).** PaymentChaos runs a user command after the scenario. Exit `0` passes, non-zero fails. The command may optionally print one JSON document to stdout for rich reporting:

```json
{ "checks": [ { "name": "entitlements", "pass": false, "expected": 1, "observed": 2, "message": "…" } ] }
```

Run metadata is passed as environment variables: `PAYMENTCHAOS_RUN_ID`, `PAYMENTCHAOS_SEED`, `PAYMENTCHAOS_IDS_JSON`, and `PAYMENTCHAOS_ID_<NAME>` for each generated ID. The command runs with an explicit, allowlisted environment, never the parent process's secrets implicitly (see ADR 0006).

**HTTP assertion (v0.1).** PaymentChaos GETs a user-provided JSON endpoint and checks JSONPath expectations.

**Settling.** `assert.settle: { timeoutMs, intervalMs }` re-runs the assertion until it passes or the timeout elapses, for apps that process asynchronously.

## Consequences

- M1 ships the command assertion and `settle`; HTTP assertions follow in v0.1.
- The optional JSON contract lets the terminal/JSON/JUnit reporters show expected-vs-observed without the tool knowing the app's domain.
- Because the command controls the verdict, the app can be written in any language.
- Exit codes for the overall run: `0` pass, `1` assertion failure, `2` config/usage error, `3` target unreachable, `4` internal error.
