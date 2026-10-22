/** User-facing CLI strings (i18n-ready). */

export const messages = {
  usageHint: "Run paymentchaos run --help for usage.",
  configNotFound:
    "No paymentchaos.config.yaml found. Create one at the project root or pass a scenario file with a target.",
  scenarioNotFound: (name: string) => `Unknown scenario "${name}".`,
  didYouMean: (names: readonly string[]) =>
    names.length > 0 ? `Did you mean: ${names.join(", ")}?` : "No close matches.",
  remoteTargetBlocked:
    "Target URL is not on loopback or a private network. Re-run with --allow-remote-target <host> using the exact hostname.",
  missingTarget: (provider: string) =>
    `No target URL for provider "${provider}". Add providers.${provider}.target.url to paymentchaos.config.yaml or set target in the scenario file.`,
  yamlValidation: (file: string, line: number, message: string, hint: string) =>
    `${file}:${line}: ${message} — ${hint}`,
  planHeading: (planHash: string) => `Plan ${planHash}`,
  planDelivery: (seq: number, eventType: string, eventId: string, attempt: number) =>
    `${seq}\t${eventType}\t${eventId}\tattempt ${attempt}`,
  flowsHeading: "Lifecycle packs",
  flowsRow: (provider: string, id: string, title: string, events: string) =>
    `${provider}\t${id}\t${title}\t${events}`,
  shellQuotingNote:
    "Assertion and hook commands run in your platform shell. On Windows (cmd.exe) use double quotes; on Unix use single quotes around arguments with spaces.",
  reporterUnknown: (name: string) => `Unknown reporter "${name}". Supported: terminal.`,
  runRequiresScenario: "Provide at least one scenario name or file path.",
  providerUnknown: (provider: string, supported: readonly string[]) =>
    `Unknown provider "${provider}". Choose one of: ${supported.join(", ")}.`,
  flagNotPositiveInt: (flag: string, value: string) =>
    `Invalid value "${value}" for --${flag}. Use a positive integer.`,
  flagInvalidSeed: (value: string) =>
    `Invalid --seed "${value}". Use a safe signed integer (for example 1337 or -1).`,
  runSeedLine: (seed: number) => `seed ${seed}`,
  runArgSeed: "PRNG seed (printed either way; safe signed integer)",
  runArgRepeat: "Repeat the scenario N times",
  runArgRepeatIndex:
    "Run a single repeat index (1-based; requires the same --repeat as the original run)",
  runArgReporter: "Report format (terminal)",
  runArgOut: "Write the report to a file",
  runArgAllowRemoteTarget: "Allow a non-local target hostname",
  runArgStableIds: "Disable per-run id nonce (needed to replay a selected repeat's ids)",
  runArgTimeoutMs: "Per-delivery HTTP timeout in milliseconds (default 10000)",
} as const;
