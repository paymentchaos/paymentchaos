export const messages = {
  verifyMissingCustomer:
    "Pass the Stripe customer id (cus_…) as the first argument or set PAYMENTCHAOS_ID_CUSTOMER.",
  verifyMissingBaseUrl:
    "Pass --base-url with the example app base URL (not inherited from the parent process).",
  renewalEntitlementsOk: "Exactly one renewal entitlement exists.",
  renewalEntitlementsDuplicate: (observed: number) =>
    `Duplicate invoice.paid delivery created ${observed} entitlement records.`,
  renewalLedgerOk: "Exactly one renewal ledger entry exists.",
  renewalLedgerDuplicate: (observed: number) =>
    `Duplicate invoice.paid delivery created ${observed} renewal ledger entries.`,
  subscriptionActiveOk: "Subscription remains active after out-of-order events.",
  subscriptionActiveStaleCancel:
    "Older cancellation on a prior subscription id revoked the active subscription.",
  subscriptionIdOk: "Active subscription id matches the renewed subscription.",
  subscriptionIdStale: "Stale cancellation overwrote the active Stripe subscription id.",
  transitionWritesOk: "Exactly one audited subscription transition was recorded.",
  transitionWritesRace: (observed: number) =>
    `Concurrent subscription deliveries recorded ${observed} transition writes (expected one).`,
} as const;
