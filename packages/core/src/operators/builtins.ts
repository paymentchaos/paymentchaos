import type { Delivery } from "../contracts/index.ts";
import { type PlanDraft, ungrouped, withTag } from "../plan/draft.ts";
import {
  type ChaosOperatorDefinition,
  type OperatorParams,
  requireEventType,
} from "./definition.ts";

/**
 * The M1 chaos operators. Each returns a new draft; `applyChaos` re-normalizes seq,
 * attempt numbers, ordering and group layout after every step (see `normalizeDraft`).
 *
 * Provider sources for the failures modelled here:
 * - Stripe, "Handle duplicate events", "Event ordering" and "Retry behavior":
 *   https://docs.stripe.com/webhooks
 * - Razorpay, "Webhooks best practices" (duplicate and out-of-order events):
 *   https://razorpay.com/docs/webhooks/best-practices/
 */

/**
 * Redelivery: the provider resends the *same* logical event (same id, same body bytes)
 * with a fresh signature timestamp at send time. This is not a semantic duplicate,
 * which would carry a new event id for the same state change (v0.1 operator).
 */
export const duplicate: ChaosOperatorDefinition<OperatorParams<"duplicate">> = {
  name: "duplicate",
  models:
    "At-least-once delivery: the provider redelivers an event the app already received (Stripe and Razorpay both document duplicates).",
  apply(plan, _rng, { event, times }) {
    requireEventType(plan, "duplicate", event);
    const lastIndexById = new Map<string, number>();
    plan.deliveries.forEach((d, i) => {
      if (d.event.type === event) lastIndexById.set(d.event.id, i);
    });
    const deliveries: Delivery[] = [];
    plan.deliveries.forEach((d, i) => {
      deliveries.push(d);
      if (lastIndexById.get(d.event.id) !== i) return;
      const first = plan.deliveries.find((x) => x.event.id === d.event.id) ?? d;
      for (let n = 0; n < times; n++) {
        deliveries.push(
          withTag({ ...ungrouped(first), sendOffsetMillis: d.sendOffsetMillis }, "duplicate"),
        );
      }
    });
    return { ...plan, deliveries };
  },
};

/**
 * Out-of-order delivery: the listed event types are delivered in the listed order.
 * The positions (and send offsets) those deliveries occupy are kept; only which
 * delivery fills each position changes, so the delivery multiset is preserved.
 */
export const reorder: ChaosOperatorDefinition<OperatorParams<"reorder">> = {
  name: "reorder",
  models: "Providers do not guarantee events arrive in the order they were generated.",
  apply(plan, _rng, order) {
    for (const type of order) requireEventType(plan, "reorder", type);
    const rank = (type: string) => order.indexOf(type);
    const slots = plan.deliveries.flatMap((d, i) => (rank(d.event.type) >= 0 ? [i] : []));
    const moved = slots
      .map((i) => plan.deliveries[i] as Delivery)
      .map((d, i) => ({ d, i }))
      .sort((a, b) => rank(a.d.event.type) - rank(b.d.event.type) || a.i - b.i)
      .map(({ d }) => d);
    const deliveries = [...plan.deliveries];
    slots.forEach((slot, k) => {
      const incoming = moved[k] as Delivery;
      const offset = (plan.deliveries[slot] as Delivery).sendOffsetMillis;
      deliveries[slot] = withTag({ ...incoming, sendOffsetMillis: offset }, "reorder");
    });
    return { ...plan, deliveries };
  },
};

/** Late delivery: hold every delivery of an event type back by a logical delay. */
export const delay: ChaosOperatorDefinition<OperatorParams<"delay">> = {
  name: "delay",
  models:
    "Provider retries and queueing deliver some events minutes to days after others; offsets are scaled by timeScale at send time.",
  apply(plan, _rng, { event, byMs }) {
    requireEventType(plan, "delay", event);
    return {
      ...plan,
      deliveries: plan.deliveries.map((d) =>
        d.event.type === event
          ? withTag({ ...d, sendOffsetMillis: d.sendOffsetMillis + byMs }, "delay")
          : d,
      ),
    };
  },
};

/**
 * Concurrent retries: several deliveries of the same event in flight at once, as when a
 * provider times out on a slow endpoint and retries while the first attempt is still
 * processing. The first delivery of each matching event gets `deliveries - 1` copies in
 * its concurrency group (joining its existing group, if any).
 */
export const concurrent: ChaosOperatorDefinition<OperatorParams<"concurrent">> = {
  name: "concurrent",
  models:
    "A provider retry overlapping a slow first attempt; exposes non-atomic check-then-insert idempotency.",
  apply(plan: PlanDraft, _rng, { event, deliveries: count }) {
    requireEventType(plan, "concurrent", event);
    let groups = new Set(plan.deliveries.flatMap((d) => d.concurrencyGroup ?? [])).size;
    const seen = new Set<string>();
    const deliveries: Delivery[] = [];
    for (const d of plan.deliveries) {
      if (d.event.type !== event || seen.has(d.event.id)) {
        deliveries.push(d);
        continue;
      }
      seen.add(d.event.id);
      const group = d.concurrencyGroup ?? `g${String(++groups)}`;
      const member = withTag({ ...d, concurrencyGroup: group }, "concurrent");
      deliveries.push(member);
      for (let n = 1; n < count; n++) deliveries.push(member);
    }
    return { ...plan, deliveries };
  },
};
