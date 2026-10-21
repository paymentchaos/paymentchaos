import { asInstant, type Instant, type LogicalClock } from "../contracts/index.ts";
import { messages } from "../messages.ts";

/**
 * Fixed start of logical time, 2026-01-01T00:00:00.000Z. Planning never reads the
 * wall clock, so event timestamps are identical on every run (ADR 0003).
 */
export const LOGICAL_EPOCH: Instant = asInstant(1_767_225_600_000);

class MonotonicLogicalClock implements LogicalClock {
  #now: number;

  constructor(start: Instant) {
    this.#now = start;
  }

  now(): Instant {
    return asInstant(this.#now);
  }

  advance(millis: number): void {
    if (!Number.isFinite(millis) || millis < 0) {
      throw new RangeError(messages.clockAdvanceInvalid(millis));
    }
    this.#now += millis;
  }
}

export function createLogicalClock(start: Instant = LOGICAL_EPOCH): LogicalClock {
  if (!Number.isSafeInteger(start)) throw new RangeError(messages.clockStartInvalid(start));
  return new MonotonicLogicalClock(start);
}
