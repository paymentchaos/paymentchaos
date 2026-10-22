import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { grantsAccess } from "./subscriptions.js";

/** https://docs.stripe.com/api/subscriptions/object#subscription_object-status */
export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "paused"
  | "trialing"
  | "unpaid";

export interface AppState {
  /** One row per Stripe subscription id the customer has had, oldest first. */
  subscriptions: Array<{
    stripeSubscriptionId: string;
    status: SubscriptionStatus;
    lastEventCreated: number;
    grantsAccess: boolean;
  }>;
  /** The customer's entitlement: true when any of their subscriptions grants access. */
  hasAccess: boolean;
  entitlements: Array<{
    id: number;
    kind: string;
    sourceEventId: string;
    invoiceId: string | null;
  }>;
  ledger: Array<{
    id: number;
    type: string;
    amountMinor: number;
    currency: string;
    sourceEventId: string;
  }>;
  subscriptionTransitionCount: number;
}

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      stripe_customer_id TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS stripe_subscriptions (
      stripe_subscription_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      status TEXT NOT NULL,
      last_event_created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS stripe_subscriptions_by_customer
      ON stripe_subscriptions(customer_id);
    CREATE TABLE IF NOT EXISTS entitlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      kind TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      invoice_id TEXT
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      source_event_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id TEXT PRIMARY KEY,
      processed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscription_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      event_id TEXT NOT NULL,
      stripe_subscription_id TEXT NOT NULL,
      status TEXT NOT NULL,
      event_created INTEGER NOT NULL
    );
  `);
  return db;
}

/** Resolve `cus_…` Stripe ids or internal `cus_internal_…` keys to the customers row id. */
export function resolveInternalCustomerId(db: DatabaseSync, query: string): string {
  if (query.startsWith("cus_internal_")) {
    return query;
  }
  if (query.startsWith("cus_")) {
    const row = db.prepare("SELECT id FROM customers WHERE stripe_customer_id = ?").get(query) as
      | { id: string }
      | undefined;
    if (row) {
      return row.id;
    }
  }
  return query;
}

export function readState(db: DatabaseSync, customerQuery: string): AppState {
  const customerId = resolveInternalCustomerId(db, customerQuery);

  const subscriptionRows = db
    .prepare(
      `SELECT stripe_subscription_id, status, last_event_created
       FROM stripe_subscriptions WHERE customer_id = ? ORDER BY rowid`,
    )
    .all(customerId) as Array<{
    stripe_subscription_id: string;
    status: string;
    last_event_created: number;
  }>;
  const subscriptions = subscriptionRows.map((row) => ({
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status as SubscriptionStatus,
    lastEventCreated: row.last_event_created,
    grantsAccess: grantsAccess(row.status),
  }));

  const entitlementRows = db
    .prepare(
      `SELECT id, kind, source_event_id, invoice_id
       FROM entitlements WHERE customer_id = ? ORDER BY id`,
    )
    .all(customerId) as Array<{
    id: number;
    kind: string;
    source_event_id: string;
    invoice_id: string | null;
  }>;

  const ledger = db
    .prepare(
      `SELECT id, type, amount_minor, currency, source_event_id
       FROM ledger WHERE customer_id = ? ORDER BY id`,
    )
    .all(customerId) as Array<{
    id: number;
    type: string;
    amount_minor: number;
    currency: string;
    source_event_id: string;
  }>;

  const transitionRow = db
    .prepare("SELECT COUNT(*) AS n FROM subscription_transitions WHERE customer_id = ?")
    .get(customerId) as { n: number };

  return {
    subscriptions,
    hasAccess: subscriptions.some((row) => row.grantsAccess),
    entitlements: entitlementRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      sourceEventId: row.source_event_id,
      invoiceId: row.invoice_id,
    })),
    ledger: ledger.map((row) => ({
      id: row.id,
      type: row.type,
      amountMinor: row.amount_minor,
      currency: row.currency,
      sourceEventId: row.source_event_id,
    })),
    subscriptionTransitionCount: transitionRow.n,
  };
}

export function resetDatabase(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM subscription_transitions;
    DELETE FROM ledger;
    DELETE FROM entitlements;
    DELETE FROM processed_events;
    DELETE FROM stripe_subscriptions;
    DELETE FROM customers;
  `);
}
