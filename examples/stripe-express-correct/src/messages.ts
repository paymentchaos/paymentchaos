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
  subscriptionActiveOk: "The customer still has an active subscription after out-of-order events.",
  subscriptionActiveStaleCancel:
    "The customer has no active subscription: an out-of-order event revoked access.",
  subscriptionIdOk: "The renewed subscription is active.",
  subscriptionIdStale: "The renewed subscription is not active: a stale event overwrote it.",
  transitionWritesOk: "Exactly one audited subscription transition was recorded.",
  transitionWritesRace: (observed: number) =>
    `Concurrent subscription deliveries recorded ${observed} transition writes (expected one).`,
} as const;
