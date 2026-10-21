import { randomInt, randomUUID } from "node:crypto";
import {
  type CommandAssertionOutcome,
  commandAssertionResults,
  DEFAULT_COMMAND_TIMEOUT_MS,
  runCommandAssertion,
} from "../assert/command.ts";
import { buildCommandEnv, type RunMetadata } from "../assert/env.ts";
import { runShellCommand } from "../assert/shell.ts";
import {
  type AssertionResult,
  asInstant,
  asSecretRef,
  type DeliveryPlan,
  PaymentChaosError,
  type ProviderAdapter,
  type RunReport,
  type Scenario,
  type SigningKeySet,
  toIso8601,
} from "../contracts/index.ts";
import {
  type DeliveryOutcome,
  type ExecutionResult,
  executePlan,
  resolveRequestTimeout,
} from "../executor/execute.ts";
import { messages } from "../messages.ts";
import type { OperatorRegistry } from "../operators/registry.ts";
import { compilePlan } from "../plan/compile.ts";
import { createRunNonce } from "../runtime/ids.ts";
import { type Env, redactSecrets, resolveSecret, secretValues } from "../safety/secrets.ts";
import { assertTargetAllowed } from "../safety/target-guard.ts";

export interface RunScenarioOptions {
  readonly adapter: ProviderAdapter;
  /** Overrides `scenario.seed` (`--seed`). Random when neither is set. */
  readonly seed?: number;
  /** Overrides `scenario.repeat` (`--repeat`). */
  readonly repeat?: number;
  /**
   * Run only this 1-based repetition of `repeat` (`--repeat-index`). It labels the run's
   * metadata; it does not replay the original interleaving or, without `stableIds`, its ids.
   */
  readonly repeatIndex?: number;
  /** Disable the per-repeat id nonce (`--stable-ids`). */
  readonly stableIds?: boolean;
  readonly allowRemoteTarget?: string | readonly string[];
  readonly timeScale?: number;
  /** Local per-request timeout for each delivery; see `ExecuteOptions.timeoutMillis`. */
  readonly timeoutMillis?: number;
  /** Working directory for hooks and the assertion command. */
  readonly cwd?: string;
  /** Extra parent variables to pass to hooks and the assertion command. */
  readonly passEnv?: readonly string[];
  /** Where secret references resolve. Defaults to `process.env`. */
  readonly env?: Env;
  readonly commandTimeoutMs?: number;
  readonly runId?: string;
  readonly signal?: AbortSignal;
  readonly operators?: OperatorRegistry;
  readonly onEvent?: (event: RunEvent) => void;
}

export type RunEvent =
  | { readonly type: "plan"; readonly plan: DeliveryPlan }
  | { readonly type: "repeat-start"; readonly index: number }
  | { readonly type: "delivery"; readonly index: number; readonly outcome: DeliveryOutcome }
  | { readonly type: "repeat-end"; readonly index: number; readonly repeat: RepeatOutcome };

export interface RepeatOutcome {
  /** 1-based. */
  readonly index: number;
  readonly pass: boolean;
  readonly ids: Readonly<Record<string, string>>;
  readonly execution: ExecutionResult;
  readonly assertions: readonly AssertionResult[];
  readonly command?: CommandAssertionOutcome;
}

export interface RunOutcome {
  /**
   * The contract report. Its deliveries and assertions are the first failed repeat's, else
   * the last's; `repeat` and `repeatsFailed` count executed repetitions only.
   */
  readonly report: RunReport;
  /** The plan, compiled with the first repeat's nonce. */
  readonly plan: DeliveryPlan;
  /** The repetitions actually executed; one when `repeatIndex` is set. */
  readonly repeats: readonly RepeatOutcome[];
  /** Human-readable caveats for the reporter (e.g. "a pass does not prove no race"). */
  readonly notes: readonly string[];
}

/** A random seed for runs that don't set one. Always printed by reporters. */
export function generateSeed(): number {
  return randomInt(0, 2 ** 31);
}

/**
 * Built-in check 1: every validly signed delivery is accepted within PaymentChaos's local
 * request timeout. That timeout is a simulation setting, not a provider guarantee.
 */
export function deliveriesAcceptedCheck(execution: ExecutionResult): AssertionResult {
  const rejected = execution.deliveries.filter((d) => !d.accepted);
  const total = execution.deliveries.length;
  return {
    name: messages.acceptedCheckName(),
    pass: rejected.length === 0,
    expected: total,
    observed: total - rejected.length,
    ...(rejected.length === 0
      ? {}
      : {
          message: messages.acceptedCheckFailed(
            rejected.map((d) => ({
              seq: d.seq,
              eventType: d.eventType,
              status: d.statusCode,
              error: d.error,
            })),
          ),
        }),
  };
}

/**
 * Run a validated scenario end to end: compile, then for each repetition run the
 * `beforeEach` hook, execute the plan, run built-in and command assertions, and run the
 * `afterEach` hook. Races are nondeterministic on the target side, so each repetition
 * is judged separately and the report says how many failed (ADR 0003).
 */
export async function runScenario(
  scenario: Scenario,
  options: RunScenarioOptions,
): Promise<RunOutcome> {
  const { adapter } = options;
  const target = scenario.target;
  if (target === undefined)
    throw new PaymentChaosError("CONFIG_INVALID", messages.targetMissing(scenario.provider));
  const guard =
    options.allowRemoteTarget === undefined ? {} : { allowRemoteTarget: options.allowRemoteTarget };
  // Before any hook or send: a blocked target must have no side effects at all.
  assertTargetAllowed(target.url, guard);
  const timeoutMillis = resolveRequestTimeout(options.timeoutMillis);
  const repeat = options.repeat ?? scenario.repeat;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.repeatInvalid(repeat));
  }
  const selected = options.repeatIndex;
  if (
    selected !== undefined &&
    (!Number.isInteger(selected) || selected < 1 || selected > repeat)
  ) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.repeatIndexInvalid(selected, repeat));
  }
  const indices =
    selected === undefined ? Array.from({ length: repeat }, (_, i) => i + 1) : [selected];
  if (target.secret === undefined) {
    throw new PaymentChaosError("SECRET_MISSING", messages.targetSecretMissing(scenario.provider));
  }
  const env = options.env ?? process.env;
  const keys: SigningKeySet = { current: asSecretRef(target.secret) };
  resolveSecret(keys.current, env);
  const redact = secretValues(keys, env);

  const seed = options.seed ?? scenario.seed ?? generateSeed();
  const runId = options.runId ?? `run_${randomUUID()}`;
  const startedAt = toIso8601(asInstant(Date.now()));
  const compileOptions = (nonce: string | undefined) => ({
    seed,
    ...(nonce === undefined ? {} : { nonce }),
    ...(options.operators === undefined ? {} : { operators: options.operators }),
  });
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const shared = {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.passEnv === undefined ? {} : { passEnv: options.passEnv }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  const runHook = async (
    phase: "beforeEach" | "afterEach",
    command: string | undefined,
    metadata: RunMetadata,
  ) => {
    if (command === undefined) return;
    const result = await runShellCommand(command, {
      ...shared,
      env: buildCommandEnv(metadata, shared),
      timeoutMs: commandTimeoutMs,
    });
    options.signal?.throwIfAborted();
    if (result.exitCode !== 0) {
      const stderr = redactSecrets(result.spawnError ?? result.stderr, redact)
        .trim()
        .slice(-2000);
      throw new PaymentChaosError(
        "CONFIG_INVALID",
        messages.hookFailed(phase, command, result.exitCode, result.timedOut, stderr),
        {
          details: { phase, exitCode: result.exitCode },
        },
      );
    }
  };

  let plan: DeliveryPlan | undefined;
  const repeats: RepeatOutcome[] = [];
  for (const index of indices) {
    const compiled = compilePlan(
      scenario,
      adapter,
      compileOptions(options.stableIds === true ? undefined : createRunNonce()),
    );
    if (plan === undefined) {
      plan = compiled.plan;
      options.onEvent?.({ type: "plan", plan });
    } else if (compiled.plan.planHash !== plan.planHash) {
      throw new PaymentChaosError("INTERNAL", messages.planHashDrift());
    }
    options.onEvent?.({ type: "repeat-start", index });
    const metadata: RunMetadata = {
      runId,
      seed,
      planHash: plan.planHash,
      repeatIndex: index,
      ids: compiled.ids,
    };

    await runHook("beforeEach", scenario.hooks?.beforeEach, metadata);
    const execution = await executePlan(compiled, adapter, {
      url: target.url,
      keys,
      env,
      ...guard,
      timeoutMillis,
      ...(options.timeScale === undefined ? {} : { timeScale: options.timeScale }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onDelivery: (outcome) => options.onEvent?.({ type: "delivery", index, outcome }),
    });
    const assertions: AssertionResult[] = [deliveriesAcceptedCheck(execution)];
    let command: CommandAssertionOutcome | undefined;
    if (scenario.assert?.command !== undefined) {
      command = await runCommandAssertion(scenario.assert.command, {
        ...shared,
        metadata,
        redact,
        timeoutMs: commandTimeoutMs,
        ...(scenario.assert.settle === undefined ? {} : { settle: scenario.assert.settle }),
      });
      assertions.push(...commandAssertionResults(command));
    }
    await runHook("afterEach", scenario.hooks?.afterEach, metadata);

    const outcome: RepeatOutcome = {
      index,
      pass: assertions.every((a) => a.pass),
      ids: compiled.ids,
      execution,
      assertions,
      ...(command === undefined ? {} : { command }),
    };
    repeats.push(outcome);
    options.onEvent?.({ type: "repeat-end", index, repeat: outcome });
  }

  const finalPlan = plan as DeliveryPlan;
  const failed = repeats.filter((r) => !r.pass);
  const shown = failed[0] ?? (repeats.at(-1) as RepeatOutcome);
  // Counts describe repetitions actually executed, never the unexecuted rest of `repeat`.
  const executed = repeats.length;
  const notes: string[] = [];
  if (scenario.assert?.http !== undefined) notes.push(messages.httpAssertNotYetSupported());
  if (selected !== undefined)
    notes.push(messages.repeatSelected(selected, repeat, options.stableIds === true));
  if (failed.length > 0 && executed > 1)
    notes.push(messages.repeatsFailed(failed.length, executed, shown.index));
  if (failed.length === 0 && finalPlan.deliveries.some((d) => d.concurrencyGroup !== undefined)) {
    notes.push(messages.raceNotProven(executed));
  }

  const report: RunReport = {
    schemaVersion: 1,
    runId,
    seed,
    planHash: finalPlan.planHash,
    provider: adapter.id,
    scenario: scenario.name,
    startedAt,
    finishedAt: toIso8601(asInstant(Date.now())),
    repeat: executed,
    repeatsFailed: failed.length,
    status: failed.length === 0 ? "passed" : "failed",
    deliveries: shown.execution.deliveries.map(
      ({ concurrencyGroup: _g, accepted: _a, sentAt: _s, ...result }) => result,
    ),
    assertions: [...shown.assertions],
  };
  return { report, plan: finalPlan, repeats, notes };
}
