import type { EventId, Instant } from "./brand.ts";

/** HTTP headers as a plain map. Case handling is the executor's responsibility. */
export type Headers = Record<string, string>;

/**
 * One provider event with a stable identity and an object snapshot. A single logical
 * event may be delivered many times (redelivery). See the domain model in the build
 * prompt, §6.
 */
export interface LogicalEvent {
  readonly id: EventId;
  /** Provider event type, e.g. `invoice.paid`. */
  readonly type: string;
  /** The provider object snapshot carried by the event. Shape is provider-specific. */
  readonly object: unknown;
  /** When the event logically occurred (UTC). */
  readonly occurredAt: Instant;
}

/** A minimal reference to a logical event, carried on a delivery. */
export interface LogicalEventRef {
  readonly id: EventId;
  readonly type: string;
}

/** A delivery before signing: exact body bytes plus headers. */
export interface UnsignedDelivery {
  readonly body: Buffer;
  readonly headers: Headers;
  readonly event: LogicalEventRef;
}

/**
 * A delivery after signing. The body MAY differ from the unsigned body for providers
 * whose signature lives inside the body (e.g. Adyen). See ADR 0002.
 */
export interface SignedDelivery {
  readonly body: Buffer;
  readonly headers: Headers;
}

/**
 * One fully-compiled HTTP attempt in a delivery plan. The sequence is deterministic;
 * the target's interleaving of a concurrency group is not. See ADR 0003.
 */
export interface Delivery {
  /** Deterministic position in the plan, from 0. */
  readonly seq: number;
  /** Attempt number for this logical event, from 1. */
  readonly attempt: number;
  readonly event: LogicalEvent;
  /** Deliveries sharing a group are released together behind a barrier. */
  readonly concurrencyGroup?: string;
  /** Logical send offset in milliseconds from run start, before `timeScale`. */
  readonly sendOffsetMillis: number;
  /** Names of the chaos operators that produced or touched this delivery. */
  readonly chaosTags: readonly string[];
}

/**
 * The fully compiled, deterministic plan. It is printable, diffable and hashable:
 * seed + scenario + version produce an identical plan and {@link DeliveryPlan.planHash}.
 */
export interface DeliveryPlan {
  readonly seed: number;
  /** Stable hash over the normalized plan. Identical inputs yield an identical hash. */
  readonly planHash: string;
  readonly provider: string;
  readonly flow: string;
  readonly deliveries: readonly Delivery[];
}
