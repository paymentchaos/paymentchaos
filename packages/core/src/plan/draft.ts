import type { Delivery, DeliveryPlan, LogicalEvent } from "../contracts/index.ts";

/** A delivery plan before hashing: what chaos operators consume and produce. */
export type PlanDraft = Omit<DeliveryPlan, "planHash">;

/** One delivery per logical event, in flow order, all at offset 0. */
export function createDraft(
  seed: number,
  provider: string,
  flow: string,
  events: readonly LogicalEvent[],
): PlanDraft {
  return normalizeDraft({
    seed,
    provider,
    flow,
    deliveries: events.map((event, seq) => ({
      seq,
      attempt: 1,
      event,
      sendOffsetMillis: 0,
      chaosTags: [],
    })),
  });
}

/**
 * Restore the plan invariants after every operator, so operators can stay simple:
 * - deliveries are stably sorted by send offset;
 * - a concurrency group sits contiguously at its first member's position and offset,
 *   because the whole group is released together;
 * - `seq` is the index and `attempt` counts deliveries of the same event id from 1.
 */
export function normalizeDraft(draft: PlanDraft): PlanDraft {
  const sorted = draft.deliveries
    .map((delivery, index) => ({ delivery, index }))
    .sort((a, b) => a.delivery.sendOffsetMillis - b.delivery.sendOffsetMillis || a.index - b.index)
    .map(({ delivery }) => delivery);

  const members = new Map<string, Delivery[]>();
  for (const delivery of sorted) {
    if (delivery.concurrencyGroup === undefined) continue;
    const group = members.get(delivery.concurrencyGroup) ?? [];
    group.push(delivery);
    members.set(delivery.concurrencyGroup, group);
  }

  const ordered: Delivery[] = [];
  const emitted = new Set<string>();
  for (const delivery of sorted) {
    const group = delivery.concurrencyGroup;
    if (group === undefined) {
      ordered.push(delivery);
    } else if (!emitted.has(group)) {
      emitted.add(group);
      for (const member of members.get(group) ?? []) {
        ordered.push({ ...member, sendOffsetMillis: delivery.sendOffsetMillis });
      }
    }
  }

  const attempts = new Map<string, number>();
  return {
    ...draft,
    deliveries: ordered.map((delivery, seq) => {
      const attempt = (attempts.get(delivery.event.id) ?? 0) + 1;
      attempts.set(delivery.event.id, attempt);
      return { ...delivery, seq, attempt };
    }),
  };
}

/** Append a chaos tag once. */
export function withTag(delivery: Delivery, tag: string): Delivery {
  return delivery.chaosTags.includes(tag)
    ? delivery
    : { ...delivery, chaosTags: [...delivery.chaosTags, tag] };
}

/** A copy of `delivery` outside any concurrency group. */
export function ungrouped(delivery: Delivery): Delivery {
  const { concurrencyGroup: _group, ...rest } = delivery;
  return rest;
}
