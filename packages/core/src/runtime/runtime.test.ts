import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { asInstant } from "../contracts/index.ts";
import { createLogicalClock, LOGICAL_EPOCH } from "./clock.ts";
import { createIdFactory, createRunNonce, RUN_NONCE_LENGTH } from "./ids.ts";
import { createRng } from "./rng.ts";

const seedArb = fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
const draw = (seed: number, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.int(2 ** 32));
};

describe("createRng", () => {
  it("is pinned: the algorithm is part of the plan-hash contract (ADR 0003)", () => {
    expect(draw(1337, 5)).toEqual([2457339011, 923780728, 767235183, 3695938027, 3788870003]);
    expect(createRng(1337).fork("ids").int(1_000_000)).toBe(528953);
    expect(createRng(-1).int(1_000_000)).toBe(326635);
    expect(createRng(2 ** 40).int(1_000_000)).toBe(844791);
  });

  it("produces the same stream for the same seed", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        expect(draw(seed, 8)).toEqual(draw(seed, 8));
      }),
    );
  });

  it("distinguishes seeds that differ only in the high 32 bits", () => {
    expect(draw(1, 4)).not.toEqual(draw(1 + 2 ** 32, 4));
  });

  it("keeps next() in [0, 1) and int() in range", () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 1, max: 2 ** 32 }), (seed, max) => {
        const rng = createRng(seed);
        const f = rng.next();
        const i = rng.int(max);
        return f >= 0 && f < 1 && Number.isInteger(i) && i >= 0 && i < max;
      }),
    );
  });

  it("forks by label independent of how much the parent has drawn", () => {
    fc.assert(
      fc.property(seedArb, fc.string(), fc.nat(20), (seed, label, burn) => {
        const fresh = createRng(seed).fork(label);
        const used = createRng(seed);
        for (let i = 0; i < burn; i++) used.next();
        expect(used.fork(label).int(2 ** 32)).toBe(fresh.int(2 ** 32));
      }),
    );
  });

  it("gives different labels different streams", () => {
    const rng = createRng(7);
    expect(rng.fork("generate").int(2 ** 32)).not.toBe(rng.fork("ids").int(2 ** 32));
    expect(
      rng
        .fork("a")
        .fork("b")
        .int(2 ** 32),
    ).not.toBe(
      rng
        .fork("b")
        .fork("a")
        .int(2 ** 32),
    );
  });

  it("rejects bad bounds, empty picks and unsafe seeds", () => {
    const rng = createRng(1);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(1.5)).toThrow(RangeError);
    expect(() => rng.int(2 ** 32 + 1)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => createRng(Number.NaN)).toThrow(RangeError);
    expect(() => createRng(2 ** 60)).toThrow(RangeError);
    expect(rng.pick(["only"])).toBe("only");
  });
});

describe("createIdFactory", () => {
  it("makes provider-shaped, deterministic ids", () => {
    const ids = createIdFactory(createRng(1337).fork("ids"));
    expect(ids.make("evt")).toBe("evt_pMterSuLQKPRLM9m");
    expect(ids.make("cus")).toMatch(/^cus_[0-9A-Za-z]{16}$/);
    for (const prefix of ["sub", "in", "pay", "order"]) {
      expect(ids.make(prefix)).toMatch(new RegExp(`^${prefix}_[0-9A-Za-z]{16}$`));
    }
  });

  it("mixes the nonce in without consuming randomness", () => {
    const stable = createIdFactory(createRng(9));
    const withNonce = createIdFactory(createRng(9), { nonce: "Ab3dEf7h" });
    const a = stable.make("sub");
    const b = withNonce.make("sub");
    expect(b).toBe(`sub_Ab3dEf7h${a.slice("sub_".length)}`);
  });

  it("never issues the same id twice in one factory", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const ids = createIdFactory(createRng(seed));
        const made = Array.from({ length: 200 }, () => ids.make("evt"));
        return new Set(made).size === made.length;
      }),
    );
  });

  it("names issued ids for assertion commands", () => {
    const ids = createIdFactory(createRng(3));
    const cus = ids.make("cus");
    const evt1 = ids.make("evt");
    const evt2 = ids.make("evt");
    const custom = ids.make("txn");
    expect(ids.named()).toEqual({ customer: cus, event: evt1, event_2: evt2, txn: custom });
    expect(ids.issued().map((id) => id.prefix)).toEqual(["cus", "evt", "evt", "txn"]);
  });

  it("rejects bad prefixes and nonces", () => {
    const ids = createIdFactory(createRng(1));
    for (const prefix of ["", "Evt", "evt_", "1x", "ünï"]) {
      expect(() => ids.make(prefix)).toThrow(RangeError);
    }
    expect(() => createIdFactory(createRng(1), { nonce: "short" })).toThrow(RangeError);
    expect(() => createIdFactory(createRng(1), { nonce: "has_unders" })).toThrow(RangeError);
  });

  it("creates random, well-formed run nonces", () => {
    const a = createRunNonce();
    expect(a).toMatch(new RegExp(`^[0-9A-Za-z]{${RUN_NONCE_LENGTH}}$`));
    expect(() => createIdFactory(createRng(1), { nonce: a })).not.toThrow();
    expect(createRunNonce()).not.toBe(a);
  });
});

describe("createLogicalClock", () => {
  it("starts at the fixed logical epoch in UTC", () => {
    expect(new Date(createLogicalClock().now()).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(createLogicalClock(asInstant(5)).now()).toBe(5);
    expect(LOGICAL_EPOCH).toBe(Date.UTC(2026, 0, 1));
  });

  it("advances monotonically and rejects negative or non-finite steps", () => {
    const clock = createLogicalClock(asInstant(0));
    clock.advance(1000);
    clock.advance(0);
    expect(clock.now()).toBe(1000);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => createLogicalClock(asInstant(0.5))).toThrow(RangeError);
  });
});
