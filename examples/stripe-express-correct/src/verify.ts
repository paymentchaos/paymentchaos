import type { AppState } from "./db.js";

interface CheckResult {
  name: string;
  pass: boolean;
  expected: string;
  observed: string;
  message: string;
}

function customerIdFromEnv(): string {
  const fromEnv = process.env.PAYMENTCHAOS_ID_CUSTOMER ?? process.env.CUSTOMER_ID;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  const arg = process.argv[2];
  if (arg && arg.length > 0) {
    return arg;
  }
  throw new Error(
    "Set PAYMENTCHAOS_ID_CUSTOMER (or pass customer id as the first argument) before running verify.",
  );
}

async function fetchState(baseUrl: string, customerId: string): Promise<AppState> {
  const url = new URL("/__test__/state", baseUrl);
  url.searchParams.set("customer", customerId);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`state endpoint returned ${response.status}`);
  }
  return (await response.json()) as AppState;
}

function buildChecks(state: AppState): CheckResult[] {
  const renewalEntitlements = state.entitlements.filter((row) => row.kind === "renewal");
  const renewalLedger = state.ledger.filter((row) => row.type === "renewal");

  const checks: CheckResult[] = [
    {
      name: "renewal_entitlements",
      pass: renewalEntitlements.length === 1,
      expected: "1",
      observed: String(renewalEntitlements.length),
      message:
        renewalEntitlements.length === 1
          ? "Exactly one renewal entitlement exists."
          : "Duplicate invoice.paid delivery created two entitlement records.",
    },
    {
      name: "subscription_active",
      pass: state.subscription?.status === "active",
      expected: "active",
      observed: state.subscription?.status ?? "missing",
      message:
        state.subscription?.status === "active"
          ? "Subscription remains active after out-of-order events."
          : "Older cancellation revoked a newer active subscription.",
    },
    {
      name: "renewal_ledger",
      pass: renewalLedger.length === 1,
      expected: "1",
      observed: String(renewalLedger.length),
      message:
        renewalLedger.length === 1
          ? "Exactly one renewal ledger entry exists."
          : "Duplicate invoice.paid delivery created multiple renewal ledger entries.",
    },
  ];

  return checks;
}

async function main(): Promise<void> {
  const baseUrl = process.env.PAYMENTCHAOS_STATE_BASE_URL ?? "http://127.0.0.1:3000";
  const customerId = customerIdFromEnv();
  const state = await fetchState(baseUrl, customerId);
  const checks = buildChecks(state);
  const pass = checks.every((check) => check.pass);

  process.stdout.write(`${JSON.stringify({ checks })}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
