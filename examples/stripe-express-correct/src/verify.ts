import type { AppState } from "./db.js";
import { messages } from "./messages.js";
import { parseVerifyArgs } from "./verify-args.js";

interface CheckResult {
  name: string;
  pass: boolean;
  expected: string;
  observed: string;
  message: string;
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

function buildChecks(state: AppState, expectedActiveSubscriptionId?: string): CheckResult[] {
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
          ? messages.renewalEntitlementsOk
          : messages.renewalEntitlementsDuplicate(renewalEntitlements.length),
    },
    {
      name: "subscription_active",
      pass: state.subscription?.status === "active",
      expected: "active",
      observed: state.subscription?.status ?? "missing",
      message:
        state.subscription?.status === "active"
          ? messages.subscriptionActiveOk
          : messages.subscriptionActiveStaleCancel,
    },
    {
      name: "renewal_ledger",
      pass: renewalLedger.length === 1,
      expected: "1",
      observed: String(renewalLedger.length),
      message:
        renewalLedger.length === 1
          ? messages.renewalLedgerOk
          : messages.renewalLedgerDuplicate(renewalLedger.length),
    },
  ];

  if (expectedActiveSubscriptionId !== undefined) {
    const observedId = state.subscription?.stripeSubscriptionId ?? "missing";
    checks.push({
      name: "subscription_stripe_id",
      pass: observedId === expectedActiveSubscriptionId,
      expected: expectedActiveSubscriptionId,
      observed: observedId,
      message:
        observedId === expectedActiveSubscriptionId
          ? messages.subscriptionIdOk
          : messages.subscriptionIdStale,
    });
  }

  return checks;
}

async function main(): Promise<void> {
  const { customerId, baseUrl, expectedActiveSubscriptionId } = parseVerifyArgs(process.argv);
  const state = await fetchState(baseUrl, customerId);
  const checks = buildChecks(state, expectedActiveSubscriptionId);
  const pass = checks.every((check) => check.pass);

  process.stdout.write(`${JSON.stringify({ checks })}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
