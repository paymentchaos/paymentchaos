import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SubscriptionStatus = "active" | "canceled" | "past_due" | "trialing";

export interface AppState {
  subscription: {
    status: SubscriptionStatus;
    stripeSubscriptionId: string;
    lastEventCreated: number;
  } | null;
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
    CREATE TABLE IF NOT EXISTS subscriptions (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id),
      stripe_subscription_id TEXT NOT NULL,
      status TEXT NOT NULL,
      last_event_created INTEGER NOT NULL DEFAULT 0
    );
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
  `);
  return db;
}

export function readState(db: DatabaseSync, customerId: string): AppState {
  const subscription = db
    .prepare(
      `SELECT stripe_subscription_id, status, last_event_created
       FROM subscriptions WHERE customer_id = ?`,
    )
    .get(customerId) as
    | { stripe_subscription_id: string; status: string; last_event_created: number }
    | undefined;

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

  return {
    subscription: subscription
      ? {
          status: subscription.status as SubscriptionStatus,
          stripeSubscriptionId: subscription.stripe_subscription_id,
          lastEventCreated: subscription.last_event_created,
        }
      : null,
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
  };
}

export function resetDatabase(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM ledger;
    DELETE FROM entitlements;
    DELETE FROM processed_events;
    DELETE FROM subscriptions;
    DELETE FROM customers;
  `);
}
