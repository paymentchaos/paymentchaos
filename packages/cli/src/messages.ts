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

export const initMessages = {
  description: "Create project configuration and an application-state assertion starter.",
  provider:
    "Provider: stripe, razorpay or generic-hmac (detect from package.json; otherwise stripe)",
  target: "Your test webhook URL (default http://127.0.0.1:3000/webhooks/<provider>)",
  secretEnv:
    "Uppercase environment variable NAME containing your test signing secret; never the secret itself",
  providerAmbiguous:
    "Both Stripe and Razorpay were detected in package.json. Choose --provider stripe or --provider razorpay.",
  secretEnvInvalid:
    "--secret-env must be an uppercase environment variable name such as STRIPE_WEBHOOK_SECRET. Provider key prefixes are refused. Supply the variable name, never its secret value.",
  targetInvalid:
    "--target must be an HTTP(S) webhook URL without credentials, query parameters or a fragment. Use a local test endpoint such as http://127.0.0.1:3000/webhooks/stripe.",
  argumentsInvalid: "Unknown init argument. Run paymentchaos init --help for supported options.",
  manifestInvalid: (file: string) =>
    `${file}: could not read a valid package.json object. Fix its JSON and file permissions before running init.`,
  writeFailed: (cwd: string, code: string) =>
    `Could not initialize PaymentChaos in ${cwd} (${code}). Existing paymentchaos.config.yaml files and paymentchaos directories are never overwritten. Use a fresh project directory, or configure your existing files manually; check write permissions.`,
  created: (provider: string, framework: string, env: string, scenario: string, generic: boolean) =>
    `Created paymentchaos.config.yaml and paymentchaos/verify.mjs for ${provider}.${framework ? ` Detected ${framework}; review the webhook route for your app.` : " Review the webhook route for your app."}\n\nNext:\n1. Set ${env} in your terminal to your test application's signing secret.${generic ? " The built-in generic scenario uses Standard Webhooks: whsec_ followed by base64 of 24–64 secret bytes." : ""}\n2. Replace the failing starter in paymentchaos/verify.mjs with checks against your app's state. Use PAYMENTCHAOS_IDS_JSON to identify this run's records.\n3. Start your local or staging app, then run ${scenario} with --seed 1337 using your PaymentChaos CLI. Remote targets also require --allow-remote-target <host> on run.\n\nInit sends no webhooks. The generated assertion fails until you implement it.`,
  assertionTemplate: `// Replace this starter with checks against your application's database or test API.
// Generated IDs are available in process.env.PAYMENTCHAOS_IDS_JSON.
// Exit nonzero whenever an invariant fails; never replace this with an unconditional pass.
console.log(JSON.stringify({ checks: [{
  name: "application state assertion configured",
  pass: false,
  message: "Implement paymentchaos/verify.mjs to verify one entitlement and one ledger entry per payment in your application's state."
}] }));
process.exitCode = 1;
`,
} as const;
