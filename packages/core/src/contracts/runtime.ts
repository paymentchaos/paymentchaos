/**
 * Deterministic primitives injected into planning. Everything that could introduce
 * nondeterminism (randomness, IDs, time) is an explicit dependency so that seed +
 * scenario + version always compile to the same delivery plan. See ADR 0003.
 */

/**
 * A seeded, versioned pseudo-random generator. Implementations must not use the
 * platform RNG, so results match across Node versions and operating systems.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Pick one element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /**
   * Derive an independent sub-generator keyed by a label. The same label always
   * yields the same stream, so unrelated parts of planning don't interfere.
   */
  fork(label: string): Rng;
}

/**
 * Produces provider-shaped identifiers (e.g. `evt_…`, `cus_…`) deterministically from
 * the seeded RNG plus a per-run nonce, so repeated runs against a persistent database
 * don't collide. The nonce is disabled by `--stable-ids` for golden snapshots.
 */
export interface IdFactory {
  /** Make an identifier with the given provider prefix, e.g. `make("evt")`. */
  make(prefix: string): string;
}
