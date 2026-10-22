# @paymentchaos/core

The PaymentChaos engine: frozen contracts, the deterministic plan compiler, chaos operators, the HTTP executor and the assertion runner. Provider adapters and the CLI build on this package; it never imports either.

## Engine surface

```ts
import { compilePlan, runScenario, scenarioSchema } from "@paymentchaos/core";

const scenario = scenarioSchema.parse(yamlObject);  // CLI merges project config first
const outcome = await runScenario(scenario, { adapter, seed, repeat, allowRemoteTarget });
outcome.report;   // RunReport (contract), outcome.repeats for per-repetition detail
```

| Export | What it does |
|---|---|
| `compilePlan(scenario, adapter, { seed, nonce? })` | Scenario + adapter → `{ plan, bodies, ids, apiVersion }`. Pure; same seed + scenario + engine version → same `plan.planHash`, with or without a nonce. Powers `paymentchaos plan`. |
| `applyChaos`, `defaultOperatorRegistry` | Apply `duplicate`, `reorder`, `delay`, `concurrent` in declared order. |
| `executePlan(compiled, adapter, { url, keys, timeScale?, timeoutMillis?, allowRemoteTarget?, onDelivery? })` | Sends the plan with undici. Concurrency groups are released together; delays are scaled by `timeScale`. Each request gets the local `timeoutMillis` (default `DEFAULT_REQUEST_TIMEOUT_MS`, 10 000 ms) as its only deadline: undici's header and body timeouts are disabled per request, on injected dispatchers too. |
| `runCommandAssertion(command, { metadata, settle? })` | Runs the assertion command (exit 0 = pass) with the allowlisted environment and parses the optional JSON result document. |
| `runScenario(scenario, options)` | The whole run: hooks, compile, execute, built-in check, command assertion, `repeat`. Accepts `timeoutMillis` and passes it to every execution. Emits `RunEvent`s for live output. |
| `assertTargetAllowed(url, { allowRemoteTarget })` | Remote-target guard. `executePlan` and `runScenario` call it before any hook or send. |
| `resolveSecret`, `redactSecrets` | `${ENV_VAR}` resolution for adapters; scrubbing secrets out of error text. |
| `createRng`, `createIdFactory`, `createLogicalClock` | The deterministic primitives that `GenerateContext` hands to adapters. |

`@paymentchaos/core/testing` exports `createFakeProvider` (a contract-conforming test double, not a real provider) and `startRecordingServer` (a local target that records raw bytes and in-flight concurrency).

## Semantics worth knowing

- **Redelivery vs semantic duplicate.** `duplicate` and `concurrent` redeliver the *same* logical event: same id, same body bytes, and a fresh signature timestamp per attempt. A semantic duplicate (new event id, same state change) is a separate v0.1 operator.
- **Plan invariants.** After every operator, deliveries are sorted by send offset, each concurrency group is contiguous at its first member's offset, `seq` is the index, and `attempt` counts deliveries of one event id from 1.
- **Plan hash.** SHA-256 over every delivery's position, attempt, event, group, offset, tags and a digest of the exact body bytes, plus the PRNG and plan-format versions. Target, secrets, assertions and `repeat` are excluded. The run nonce is stripped first.
- **Repeat.** Each repetition gets a fresh id nonce (unless `stableIds`), so the plan hash stays the same but ids don't collide in a persistent database. The report shows the first failed repetition and how many failed. A passing concurrent run never claims to prove that no race exists.
- **Repeat index.** `repeatIndex: k` (1 to the effective `repeat`) runs only repetition *k*: one compile, one set of hooks, deliveries and assertions, with `PAYMENTCHAOS_REPEAT_INDEX=k`, `RepeatOutcome.index` and `RunEvent` indices set to *k*. Earlier repetitions are not run. The report's `repeat` and `repeatsFailed` count only that one executed repetition. Seed and plan hash are unchanged; ids are fresh unless `stableIds`, which reproduces them. The index selects the run's metadata, not the original interleaving: replaying concurrent deliveries does not guarantee the same outcome. An out-of-range or non-integer index fails with `CONFIG_INVALID` before any hook or send.
- **Request timeout and provider timing.** `timeoutMillis` is PaymentChaos's local per-request timeout: a whole number from 1 to 2147483647 ms, default 10 000 ms, validated before secrets, hooks or sends (`CONFIG_INVALID`). It is not a provider guarantee, and the adapter's `deliveryProfile.timeoutMillis` never changes it. In a `DeliveryProfile`, `null` means the provider doesn't publish the value; a `retryScheduleMillis` of `[]` means the provider documents no automatic retries. Built-in check 1 counts a delivery as accepted only if it gets an accepted status within the local timeout. M1 schedules no automatic retries; redeliveries come only from the scenario's chaos operators. See ADR 0009.
- **Command environment.** `PATH`, `HOME`, locale and the Windows essentials (`COMMAND_ENV_ALLOWLIST`), anything named in `passEnv`, and `PAYMENTCHAOS`, `PAYMENTCHAOS_RUN_ID`, `PAYMENTCHAOS_SEED`, `PAYMENTCHAOS_PLAN_HASH`, `PAYMENTCHAOS_REPEAT_INDEX`, `PAYMENTCHAOS_IDS_JSON` and `PAYMENTCHAOS_ID_<NAME>`. Nothing else from the parent environment is passed.
