import type { Rng } from "../contracts/index.ts";
import { messages } from "../messages.ts";

/**
 * Identifier of the PRNG algorithm and seeding scheme. It is folded into every plan
 * hash: changing the algorithm, the seed expansion or the fork derivation changes every
 * plan and is a breaking change (ADR 0003).
 */
export const PRNG_VERSION = "sfc32+splitmix32+fnv1a/1";

type Words = readonly [number, number, number, number];

const GOLDEN = 0x9e3779b9;
const TWO_POW_32 = 0x1_0000_0000;

/** murmur3 32-bit finalizer. */
function fmix32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function splitmix32(state: number): () => number {
  let s = state >>> 0;
  return () => {
    s = (s + GOLDEN) >>> 0;
    return fmix32(s);
  };
}

const utf8 = new TextEncoder();

function fnv1a(bytes: Uint8Array, basis: number): number {
  let h = basis >>> 0;
  for (const byte of bytes) {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return h;
}

/** Expand a safe-integer seed (any sign) into four state words, using all 64 bits. */
function wordsFromSeed(seed: number): Words {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(messages.rngSeedInvalid(seed));
  }
  const bits = BigInt.asUintN(64, BigInt(seed));
  const lo = splitmix32(Number(bits & 0xffff_ffffn));
  const hi = splitmix32(Number(bits >> 32n) ^ GOLDEN);
  return [lo(), hi(), lo(), hi()];
}

/** Derive a child's state from the parent's *initial* state, so forks ignore draw order. */
function wordsForFork(parent: Words, label: string): Words {
  const bytes = utf8.encode(label);
  const derive = (i: 0 | 1 | 2 | 3) =>
    fmix32((fnv1a(bytes, 0x811c9dc5 ^ parent[i]) + Math.imul(i + 1, GOLDEN)) >>> 0);
  return [derive(0), derive(1), derive(2), derive(3)];
}

/**
 * sfc32 (Chris Doty-Humphrey's Small Fast Counting generator), 32-bit variant.
 * Self-contained so streams match on every Node version and OS.
 * Reference: https://pracrand.sourceforge.net/RNG_engines.txt
 */
class Sfc32 implements Rng {
  readonly #initial: Words;
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(words: Words) {
    this.#initial = words;
    [this.#a, this.#b, this.#c, this.#d] = words;
    // Warm-up so closely related seeds diverge before the first observable output.
    for (let i = 0; i < 15; i++) this.#u32();
  }

  #u32(): number {
    const t = (((this.#a + this.#b) >>> 0) + this.#d) >>> 0;
    this.#d = (this.#d + 1) >>> 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) >>> 0;
    this.#c = ((this.#c << 21) | (this.#c >>> 11)) >>> 0;
    this.#c = (this.#c + t) >>> 0;
    return t;
  }

  next(): number {
    return this.#u32() / TWO_POW_32;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO_POW_32) {
      throw new RangeError(messages.rngIntRangeInvalid(maxExclusive));
    }
    // Rejection sampling keeps the distribution exactly uniform.
    const limit = TWO_POW_32 - (TWO_POW_32 % maxExclusive);
    let value = this.#u32();
    while (value >= limit) value = this.#u32();
    return value % maxExclusive;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError(messages.rngPickEmpty());
    return items[this.int(items.length)] as T;
  }

  fork(label: string): Rng {
    return new Sfc32(wordsForFork(this.#initial, label));
  }
}

/** Create the seeded PRNG for a run. Same seed, same stream, everywhere. */
export function createRng(seed: number): Rng {
  return new Sfc32(wordsFromSeed(seed));
}
