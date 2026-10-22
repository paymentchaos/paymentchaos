import type { DatabaseSync } from "node:sqlite";
import { TERMINAL_STATUSES } from "./subscriptions.js";

type StripeEvent = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

function stripeCustomerId(object: Record<string, unknown>): string {
  const customer = object.customer;
  if (typeof customer === "string") {
    return customer;
  }
  throw new Error("expected string customer id on event object");
}

function internalCustomerId(db: DatabaseSync, stripeCustomerIdValue: string): string {
  const existing = db
    .prepare("SELECT id FROM customers WHERE stripe_customer_id = ?")
    .get(stripeCustomerIdValue) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }
  const id = `cus_internal_${stripeCustomerIdValue.slice(4)}`;
  db.prepare("INSERT INTO customers (id, stripe_customer_id) VALUES (?, ?)").run(
    id,
    stripeCustomerIdValue,
  );
  return id;
}

function claimEventId(db: DatabaseSync, eventId: string, created: number): boolean {
  const result = db
    .prepare("INSERT OR IGNORE INTO processed_events (event_id, processed_at) VALUES (?, ?)")
    .run(eventId, created);
  return result.changes === 1;
}

function grantRenewalEntitlement(
  db: DatabaseSync,
  customerId: string,
  eventId: string,
  invoice: Record<string, unknown>,
): void {
  const invoiceId = typeof invoice.id === "string" ? invoice.id : null;
  const amount =
    typeof invoice.amount_paid === "number" ? invoice.amount_paid : (invoice.total as number);
  const currency = typeof invoice.currency === "string" ? invoice.currency : "usd";

  db.prepare(
    `INSERT INTO entitlements (customer_id, kind, source_event_id, invoice_id)
     VALUES (?, 'renewal', ?, ?)`,
  ).run(customerId, eventId, invoiceId);

  db.prepare(
    `INSERT INTO ledger (customer_id, type, amount_minor, currency, source_event_id)
     VALUES (?, 'renewal', ?, ?, ?)`,
  ).run(customerId, amount, currency, eventId);
}

function recordSubscriptionTransition(
  db: DatabaseSync,
  customerId: string,
  eventId: string,
  stripeSubId: string,
  status: string,
  eventCreated: number,
): void {
  db.prepare(
    `INSERT INTO subscription_transitions
       (customer_id, event_id, stripe_subscription_id, status, event_created)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(customerId, eventId, stripeSubId, status, eventCreated);
}

const terminalPlaceholders = TERMINAL_STATUSES.map(() => "?").join(", ");

/**
 * Store one subscription snapshot, keyed by Stripe subscription id, in a single atomic
 * statement. The snapshot replaces the stored one unless:
 * - the stored status is terminal (`canceled`, `incomplete_expired`): it never reverts; or
 * - the snapshot's `event.created` is strictly older than the stored one.
 *
 * Ties: Stripe's `created` has one-second resolution, so two events for the same
 * subscription can share it and `created` cannot order them
 * (https://docs.stripe.com/webhooks#event-ordering). On a tie the later delivery wins. A
 * terminal snapshot therefore wins its second and then sticks, which is right because
 * nothing follows a terminal status for that id. A tie between two non-terminal snapshots
 * is genuinely ambiguous: production code should re-fetch the subscription from the Stripe
 * API at that point instead of trusting either snapshot.
 */
function applySubscriptionSnapshot(
  db: DatabaseSync,
  customerId: string,
  stripeSubId: string,
  status: string,
  eventCreated: number,
): void {
  db.prepare(
    `INSERT INTO stripe_subscriptions (stripe_subscription_id, customer_id, status, last_event_created)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(stripe_subscription_id) DO UPDATE SET
       status = excluded.status,
       last_event_created = excluded.last_event_created
     WHERE stripe_subscriptions.status NOT IN (${terminalPlaceholders})
       AND excluded.last_event_created >= stripe_subscriptions.last_event_created`,
  ).run(stripeSubId, customerId, status, eventCreated, ...TERMINAL_STATUSES);
}

export function handleStripeEvent(db: DatabaseSync, event: StripeEvent): void {
  if (!claimEventId(db, event.id, event.created)) {
    return;
  }

  switch (event.type) {
    case "invoice.paid": {
      const invoice = event.data.object;
      const customerId = internalCustomerId(db, stripeCustomerId(invoice));
      grantRenewalEntitlement(db, customerId, event.id, invoice);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const stripeCustomer = stripeCustomerId(subscription);
      const customerId = internalCustomerId(db, stripeCustomer);
      if (typeof subscription.id !== "string") {
        throw new Error("expected string subscription id on event object");
      }
      const stripeSubId = subscription.id;
      const status =
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : (subscription.status as string);
      recordSubscriptionTransition(db, customerId, event.id, stripeSubId, status, event.created);
      applySubscriptionSnapshot(db, customerId, stripeSubId, status, event.created);
      break;
    }
    default:
      break;
  }
}
