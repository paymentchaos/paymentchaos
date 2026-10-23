import { setTimeout as sleep } from "node:timers/promises";
import {
  type AssertionResult,
  type CommandResult,
  commandResultSchema,
  type SettleConfig,
} from "../contracts/index.ts";
import { messages } from "../messages.ts";
import { redactSecrets } from "../safety/secrets.ts";
import { buildCommandEnv, type CommandEnvOptions, type RunMetadata } from "./env.ts";
import { runShellCommand, type ShellResult } from "./shell.ts";

/** Default budget for one command execution. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const TAIL_CHARS = 2000;

export interface CommandAssertionOptions extends CommandEnvOptions {
  readonly metadata: RunMetadata;
  /** Re-run until the command passes or this elapses (ADR 0005). Omit for one attempt. */
  readonly settle?: SettleConfig;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Secret values to scrub from captured output. */
  readonly redact?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface CommandAssertionOutcome {
  readonly command: string;
  /** Exit code 0 is the verdict; the JSON document only enriches the report. */
  readonly pass: boolean;
  readonly attempts: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** Checks from the optional JSON document on stdout. */
  readonly checks: CommandResult["checks"];
  /** Set when stdout looked like a result document but did not match the protocol. */
  readonly protocolError?: string;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

/**
 * Find the result document: the whole of stdout, or, when tools print banners first
 * (`npm run` does), the trailing text from the last line that opens with `{`.
 */
export function parseCommandOutput(stdout: string): {
  result?: CommandResult;
  protocolError?: string;
} {
  const text = stdout.trim();
  if (text === "") return {};
  const starts = [0];
  for (let i = text.indexOf("\n{"); i !== -1; i = text.indexOf("\n{", i + 1)) starts.push(i + 1);
  let lastError: string | undefined;
  for (const start of starts.reverse()) {
    let json: unknown;
    try {
      json = JSON.parse(text.slice(start));
    } catch {
      continue;
    }
    const parsed = commandResultSchema.safeParse(json);
    if (parsed.success) return { result: parsed.data };
    lastError = messages.commandProtocolInvalid(parsed.error.issues[0]?.message ?? "");
  }
  return lastError === undefined ? {} : { protocolError: lastError };
}

const tail = (text: string) => (text.length > TAIL_CHARS ? text.slice(-TAIL_CHARS) : text);

function outcomeOf(
  command: string,
  run: ShellResult,
  attempts: number,
  redact: readonly string[],
): CommandAssertionOutcome {
  const stdout = redactSecrets(run.stdout, redact);
  const stderr = redactSecrets(run.spawnError ?? run.stderr, redact);
  const parsed = parseCommandOutput(stdout);
  return {
    command,
    pass: run.exitCode === 0 && !run.timedOut,
    attempts,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    checks: parsed.result?.checks ?? [],
    ...(parsed.protocolError === undefined ? {} : { protocolError: parsed.protocolError }),
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  };
}

/**
 * Run a command assertion (ADR 0005): exit 0 passes, anything else fails. With
 * `settle`, re-run every `intervalMs` until it passes or `timeoutMs` elapses, for apps
 * that acknowledge fast and process asynchronously.
 */
export async function runCommandAssertion(
  command: string,
  options: CommandAssertionOptions,
): Promise<CommandAssertionOutcome> {
  const env = buildCommandEnv(options.metadata, options);
  const redact = options.redact ?? [];
  const deadline = performance.now() + (options.settle?.timeoutMs ?? 0);
  const shell = {
    env,
    timeoutMs: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  for (let attempt = 1; ; attempt++) {
    const outcome = outcomeOf(command, await runShellCommand(command, shell), attempt, redact);
    options.signal?.throwIfAborted();
    const interval = options.settle?.intervalMs ?? 0;
    if (outcome.pass || options.settle === undefined || performance.now() + interval > deadline) {
      return outcome;
    }
    await sleep(
      interval,
      undefined,
      options.signal === undefined ? {} : { signal: options.signal },
    );
  }
}

/** Report rows: one for the command verdict, then one per JSON check. */
export function commandAssertionResults(outcome: CommandAssertionOutcome): AssertionResult[] {
  const verdict: AssertionResult = {
    name: messages.commandAssertionName(),
    pass: outcome.pass,
    ...(outcome.pass
      ? {}
      : {
          message: outcome.timedOut
            ? messages.commandTimedOut(outcome.attempts)
            : messages.commandFailed(outcome.exitCode, outcome.attempts, outcome.stderrTail.trim()),
        }),
  };
  const notes: AssertionResult[] =
    outcome.protocolError === undefined
      ? []
      : [{ name: messages.commandProtocolName(), pass: true, message: outcome.protocolError }];
  return [verdict, ...outcome.checks.map((check) => ({ ...check })), ...notes];
}
