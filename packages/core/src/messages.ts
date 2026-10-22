/**
 * Every user-facing string in `@paymentchaos/core`. Keeping them in one module keeps
 * translation possible later (AGENTS.md rule 9). Messages say what happened, where,
 * and how to fix it, and never interpolate a secret value.
 */
export const messages = {
  rngSeedInvalid: (seed: number) =>
    `Seed ${String(seed)} is not a safe integer. Use a whole number such as --seed 1337.`,
  rngIntRangeInvalid: (max: number) =>
    `Rng.int() needs an integer bound between 1 and 2^32, got ${String(max)}.`,
  rngPickEmpty: () => "Rng.pick() needs a non-empty array.",
  idPrefixInvalid: (prefix: string) =>
    `Id prefix "${prefix}" is invalid. Use lowercase letters and digits, such as "evt" or "cus".`,
  runNonceInvalid: (length: number) =>
    `Run nonce must be exactly ${String(length)} ASCII letters or digits.`,
  clockAdvanceInvalid: (millis: number) =>
    `LogicalClock.advance() needs a finite, non-negative number of milliseconds, got ${String(millis)}.`,
  clockStartInvalid: (start: number) =>
    `Logical clock start must be an integer epoch-millisecond instant, got ${String(start)}.`,
  targetUrlInvalid: () =>
    "Target URL is not a valid absolute URL. Set target.url to something like http://localhost:3000/webhooks/stripe.",
  targetProtocolInvalid: (protocol: string) =>
    `Target URL uses "${protocol}", but only http: and https: targets are supported.`,
  remoteTargetBlocked: (host: string) =>
    `Refusing to send signed webhooks to "${host}": it is not a loopback, private-network, .localhost, .test or .internal host. If this is a test environment you control, pass --allow-remote-target ${host}.`,
  allowRemoteTargetInvalid: (value: string) =>
    `--allow-remote-target "${value}" must be one exact hostname or IP address, without wildcards, scheme, port or path. Example: --allow-remote-target staging.example.com`,
  secretRefInvalid: () =>
    "Secret must be an environment reference like ${STRIPE_WEBHOOK_SECRET}, never a literal value.",
  secretMissing: (envVar: string) =>
    `Environment variable ${envVar} is not set or is empty. Export the webhook signing secret as ${envVar} before running.`,
  chaosEventMissing: (
    operator: string,
    eventType: string,
    flow: string,
    available: readonly string[],
  ) =>
    `Chaos operator "${operator}" targets event "${eventType}", but flow "${flow}" never delivers it. Use one of: ${available.join(", ")}.`,
  chaosOperatorUnknown: (name: string, known: readonly string[]) =>
    `Unknown chaos operator "${name}". Known operators: ${known.join(", ")}.`,
  providerMismatch: (scenarioProvider: string, adapterId: string) =>
    `Scenario declares provider "${scenarioProvider}" but was compiled with the "${adapterId}" adapter.`,
  flowUnknown: (flow: string, provider: string, flows: readonly string[]) =>
    `Provider "${provider}" has no flow "${flow}". Available flows: ${flows.join(", ")}. Run \`paymentchaos flows ${provider}\` to list them.`,
  apiVersionUnsupported: (apiVersion: string, provider: string, supported: readonly string[]) =>
    `Provider "${provider}" does not support apiVersion "${apiVersion}". Supported: ${supported.join(", ")}.`,
  eventIdDuplicated: (provider: string, eventId: string) =>
    `Provider adapter "${provider}" generated event id ${eventId} twice in one flow. This is an adapter bug; please report it.`,
  encodeNotByteStable: (provider: string, eventType: string) =>
    `Provider adapter "${provider}" encoded ${eventType} to different bytes on two calls. encode() must be deterministic; this is an adapter bug.`,
  timeScaleInvalid: (timeScale: number) =>
    `timeScale must be a finite number >= 0 (1 = real time, 0.001 = 1000x faster), got ${String(timeScale)}.`,
  requestTimeoutInvalid: (value: number, max: number, fallback: number) =>
    `timeoutMillis (PaymentChaos's local per-request timeout) must be a whole number of milliseconds from 1 to ${String(max)}, got ${String(value)}. Omit it to use the ${String(fallback)} ms default.`,
  bodyMissing: (eventId: string) =>
    `No encoded body for event ${eventId}. Execute the CompiledPlan returned by compilePlan, unmodified.`,
  signingFailed: (provider: string, eventType: string, reason: string) =>
    `The "${provider}" adapter failed to sign ${eventType}: ${reason}`,
  targetUnreachable: (host: string, code: string) =>
    `Could not connect to the target at ${host} (${code}). Is your app running and listening on that address?`,
  deliveryTimedOut: (millis: number) => `no response within ${String(millis)} ms`,
  deliveryFailed: (reason: string) => `request failed: ${reason}`,
  commandAssertionName: (command: string) => `assert.command: ${command}`,
  commandProtocolName: () => "assert.command output",
  commandProtocolInvalid: (issue: string) =>
    `stdout ended with JSON that is not a PaymentChaos result document ({ "checks": [{ "name", "pass", … }] }): ${issue}. The exit code still decides the verdict.`,
  commandTimedOut: (attempts: number) =>
    `The assertion command timed out and was stopped (attempt ${String(attempts)}). Make it finish faster or raise the command timeout.`,
  commandFailed: (exitCode: number | null, attempts: number, stderr: string) =>
    `The assertion command exited with ${exitCode === null ? "a signal" : String(exitCode)} after ${String(attempts)} attempt(s).${stderr === "" ? "" : ` stderr: ${stderr}`}`,
  acceptedCheckName: () => "every validly signed delivery is accepted",
  acceptedCheckFailed: (
    rejected: ReadonlyArray<{
      seq: number;
      eventType: string;
      status: number | undefined;
      error: string | undefined;
    }>,
  ) =>
    `${String(rejected.length)} validly signed deliver${rejected.length === 1 ? "y was" : "ies were"} not accepted: ${rejected
      .slice(0, 5)
      .map((r) => `#${String(r.seq)} ${r.eventType} (${r.error ?? `HTTP ${String(r.status)}`})`)
      .join(
        ", ",
      )}${rejected.length > 5 ? ", …" : ""}. Providers retry anything they don't see as accepted, so acknowledge duplicates and replays with a 2xx too.`,
  targetMissing: (provider: string) =>
    `No target configured for provider "${provider}". Set providers.${provider}.target.url in paymentchaos.config.yaml or target.url in the scenario.`,
  targetSecretMissing: (provider: string) =>
    `No signing secret configured for provider "${provider}". Set target.secret to an environment reference such as \${STRIPE_WEBHOOK_SECRET}.`,
  repeatInvalid: (repeat: number) =>
    `repeat must be a whole number from 1 to ${String(Number.MAX_SAFE_INTEGER)}, got ${String(repeat)}.`,
  repeatIndexInvalid: (index: number, repeat: number) =>
    `repeatIndex must be a whole number from 1 to ${String(repeat)} (the repeat count), got ${String(index)}. Pass the same --repeat as the original run, or omit --repeat-index to run every repetition.`,
  repeatSelected: (index: number, repeat: number, stableIds: boolean) =>
    `Ran only repetition ${String(index)} of ${String(repeat)}; counts cover that one run. It uses that repetition's index and the same seed and plan hash${stableIds ? " and ids" : ", with fresh ids (add stableIds to reuse them)"}. Concurrent deliveries interleave nondeterministically, so it may not reproduce the original outcome.`,
  hookFailed: (
    phase: string,
    command: string,
    exitCode: number | null,
    timedOut: boolean,
    stderr: string,
  ) =>
    `hooks.${phase} command \`${command}\` ${timedOut ? "timed out" : `exited with ${exitCode === null ? "a signal" : String(exitCode)}`}.${stderr === "" ? "" : ` stderr: ${stderr}`} Fix the hook so it exits 0.`,
  planHashDrift: () =>
    "The plan hash changed between repetitions of one run. Planning must be deterministic; this is a bug in PaymentChaos or the provider adapter.",
  httpAssertNotYetSupported: () =>
    "assert.http is not supported yet (planned for v0.1) and was ignored. Use assert.command for now.",
  repeatsFailed: (failed: number, total: number, shown: number) =>
    `${String(failed)} of ${String(total)} repetitions failed; showing repetition ${String(shown)}.`,
  raceNotProven: (total: number) =>
    `All ${String(total)} repetition(s) passed. Concurrent deliveries interleave nondeterministically on your server, so this lowers but does not rule out the chance of a race. Raise repeat to test harder.`,
} as const;
