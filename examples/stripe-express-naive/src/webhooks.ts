import type { DatabaseSync } from "node:sqlite";

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

async function yieldEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export async function handleStripeEvent(db: DatabaseSync, event: StripeEvent): Promise<void> {
  switch (event.type) {
    case "invoice.paid": {
      const invoice = event.data.object;
      const customerId = internalCustomerId(db, stripeCustomerId(invoice));
      // BUG 1: no idempotency on Stripe event id — duplicate invoice.paid deliveries
      // each grant a new renewal entitlement.
      grantRenewalEntitlement(db, customerId, event.id, invoice);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const stripeCustomer = stripeCustomerId(subscription);
      const customerId = internalCustomerId(db, stripeCustomer);
      const stripeSubId = typeof subscription.id === "string" ? subscription.id : "sub_unknown";
      const status =
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : (subscription.status as string);

      // BUG 2: non-atomic check-then-insert idempotency — concurrent deliveries can
      // both pass the SELECT before either INSERT commits.
      const seen = db
        .prepare("SELECT 1 AS ok FROM processed_events WHERE event_id = ?")
        .get(event.id) as { ok: number } | undefined;
      if (seen) {
        return;
      }
      await yieldEventLoop();

      // BUG 3: apply subscription status without ordering by event.created — an older
      // cancellation overwrites a newer active renewal.
      db.prepare(
        `INSERT INTO subscriptions (customer_id, stripe_subscription_id, status, last_event_created)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(customer_id) DO UPDATE SET
           stripe_subscription_id = excluded.stripe_subscription_id,
           status = excluded.status,
           last_event_created = excluded.last_event_created`,
      ).run(customerId, stripeSubId, status, event.created);

      try {
        db.prepare("INSERT INTO processed_events (event_id, processed_at) VALUES (?, ?)").run(
          event.id,
          event.created,
        );
      } catch {
        // Both concurrent deliveries may reach INSERT; ignore duplicate key errors.
      }
      break;
    }
    default:
      break;
  }
}
