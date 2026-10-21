import type { Instant } from "./brand.ts";

/**
 * How a provider encodes timestamps on the wire. Each adapter owns its format; the
 * engine works only in UTC {@link Instant} values. See ADR 0007.
 */
export type TimestampFormat = "unix-seconds" | "unix-millis" | "rfc3339";

/**
 * A deterministic logical clock injected into planning. Planning code must never call
 * `Date.now()` or `new Date()`; it reads time from here so runs are reproducible.
 */
export interface LogicalClock {
  /** The current logical instant (UTC epoch ms). */
  now(): Instant;
  /** Advance the logical clock by a positive number of milliseconds. */
  advance(millis: number): void;
}

/** Render a UTC instant as ISO 8601, for machine output and reports. */
export function toIso8601(instant: Instant): string {
  return new Date(instant).toISOString();
}
