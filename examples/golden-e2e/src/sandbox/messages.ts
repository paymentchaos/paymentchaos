export const messages = {
  usage: "Usage: pnpm --filter @paymentchaos/golden-e2e sandbox /absolute/path/to/sandbox",
  missingBuild: "Build PaymentChaos first with pnpm build, then rerun the sandbox.",
  timeout: "CLI did not complete normally within the sandbox's 20-second limit.",
  secretLeak: "CLI output contained a sandbox signing secret; saved output was redacted.",
  exit: (expected: number, actual: number) =>
    `Expected CLI exit ${expected}; observed ${actual}. See command logs.`,
  output: (expected: string) => `Expected CLI output to contain ${expected}. See command logs.`,
  finished: (passed: number, total: number, directory: string) =>
    `${passed}/${total} sandbox cases passed. Results: ${directory}`,
  report: (rows: { name: string; pass: boolean; error?: string }[]) =>
    `# PaymentChaos private sandbox\n\nEach case passes when the observed outcome matches the expected outcome. Deliberately broken integrations must fail.\n\n${rows.map((r, i) => `- ${r.pass ? "PASS" : "FAIL"} ${i + 1}. ${r.name}${r.error ? `: ${r.error.replaceAll("\n", " ")}` : ""}`).join("\n")}\n\nSee each numbered case folder for configuration, assertion scripts and command logs. Signing secrets exist only in memory during a run. These local mocks check per-event side effects; the existing golden suite covers Stripe subscription lifecycle rules. No real provider accounts, production databases, email delivery, load testing or exhaustive race proof are covered.\n`,
  verify: (
    url: string,
    types: readonly string[],
    money?: { currency: string; amount: number },
  ) => `const state = await (await fetch(${JSON.stringify(`${url}/state`)})).json();
const expected = ${JSON.stringify(types)};
const money = ${JSON.stringify(money ?? null)};
const checks = [
  { name: "one side effect per event type", pass: JSON.stringify(Object.keys(state.counts).sort()) === JSON.stringify([...expected].sort()) && Object.values(state.counts).every(n => n === 1), expected: Object.fromEntries(expected.map(t => [t, 1])), observed: state.counts },
  { name: "valid signatures and unchanged duplicate bytes", pass: state.rejected === 0 && state.bytesMatch },
  { name: "test marking and Unicode", pass: state.testMode && state.unicode },
  { name: "assertion environment", pass: !process.env.PC_SANDBOX_SECRET && !!process.env.PAYMENTCHAOS_IDS_JSON && !!process.env.PAYMENTCHAOS_SEED },
  { name: "integer currency amount", pass: !money || (state.money.length > 0 && state.money.every(m => m.currency.toUpperCase() === money.currency && m.amount === money.amount && Number.isSafeInteger(m.amount))) }
];
console.log(JSON.stringify({ checks }));
process.exitCode = checks.every(c => c.pass) ? 0 : 1;
`,
  reset: (url: string) =>
    `const response = await fetch(${JSON.stringify(`${url}/reset`)}); if (!response.ok) process.exitCode = 1;\n`,
  fail: "process.exitCode = 1;\n",
  falseJson:
    'console.log(JSON.stringify({ checks: [{ name: "deliberate false JSON check", pass: false }] }));\n',
};
