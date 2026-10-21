import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ChaosOperator, Delivery } from "../contracts/index.ts";
import { PaymentChaosError } from "../contracts/index.ts";
import { createDraft, type PlanDraft } from "../plan/draft.ts";
import { createLogicalClock } from "../runtime/clock.ts";
import { createIdFactory } from "../runtime/ids.ts";
import { createRng } from "../runtime/rng.ts";
import { createFakeProvider } from "../testing/fake-provider.ts";
import { applyChaos } from "./registry.ts";

function draftOf(types: readonly string[], seed = 1): PlanDraft {
  const provider = createFakeProvider({ flows: { f: types } });
  const rng = createRng(seed);
  const events = provider.generate("f", {
    rng: rng.fork("generate"),
    ids: createIdFactory(rng.fork("ids")),
    clock: createLogicalClock(),
    currency: "JPY",
  });
  return createDraft(seed, "fake", "f", events);
}

const rng = createRng(0);
const run = (draft: PlanDraft, chaos: ChaosOperator[]) => applyChaos(draft, chaos, rng);
const view = (plan: PlanDraft) =>
  plan.deliveries.map((d) => [
    d.event.type,
    d.attempt,
    d.concurrencyGroup ?? "-",
    d.sendOffsetMillis,
  ]);
const ids = (deliveries: readonly Delivery[]) => deliveries.map((d) => d.event.id);
const sorted = (xs: readonly string[]) => [...xs].sort();

describe("duplicate", () => {
  it("redelivers the same logical event right after its last delivery", () => {
    const plan = run(draftOf(["a", "b", "c"]), [{ duplicate: { event: "b", times: 2 } }]);
    expect(view(plan)).toEqual([
      ["a", 1, "-", 0],
      ["b", 1, "-", 0],
      ["b", 2, "-", 0],
      ["b", 3, "-", 0],
      ["c", 1, "-", 0],
    ]);
    const [, first, second] = plan.deliveries;
    expect(second?.event).toBe(first?.event); // same id and same object → same bytes
    expect(second?.chaosTags).toEqual(["duplicate"]);
    expect(plan.deliveries.map((d) => d.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not put redeliveries inside a concurrency group", () => {
    const plan = run(draftOf(["a"]), [
      { concurrent: { event: "a", deliveries: 2 } },
      { duplicate: { event: "a", times: 1 } },
    ]);
    expect(view(plan)).toEqual([
      ["a", 1, "g1", 0],
      ["a", 2, "g1", 0],
      ["a", 3, "-", 0],
    ]);
  });
});

describe("reorder", () => {
  it("delivers the listed types in the listed order", () => {
    const plan = run(draftOf(["a", "b", "c"]), [{ reorder: ["c", "a"] }]);
    expect(plan.deliveries.map((d) => d.event.type)).toEqual(["c", "b", "a"]);
    expect(plan.deliveries.map((d) => d.chaosTags)).toEqual([["reorder"], [], ["reorder"]]);
  });

  it("keeps the relative order of deliveries of the same type", () => {
    const plan = run(draftOf(["a", "b"]), [
      { duplicate: { event: "a", times: 1 } },
      { reorder: ["b", "a"] },
    ]);
    expect(view(plan)).toEqual([
      ["b", 1, "-", 0],
      ["a", 1, "-", 0],
      ["a", 2, "-", 0],
    ]);
  });
});

describe("delay", () => {
  it("shifts an event's deliveries later and re-sorts by offset", () => {
    const plan = run(draftOf(["a", "b", "c"]), [{ delay: { event: "a", byMs: 50 } }]);
    expect(view(plan)).toEqual([
      ["b", 1, "-", 0],
      ["c", 1, "-", 0],
      ["a", 1, "-", 50],
    ]);
    expect(plan.deliveries[2]?.chaosTags).toEqual(["delay"]);
  });

  it("accumulates and keeps byMs 0 in place", () => {
    const plan = run(draftOf(["a", "b"]), [
      { delay: { event: "a", byMs: 0 } },
      { delay: { event: "b", byMs: 10 } },
      { delay: { event: "b", byMs: 5 } },
    ]);
    expect(view(plan)).toEqual([
      ["a", 1, "-", 0],
      ["b", 1, "-", 15],
    ]);
  });
});

describe("concurrent", () => {
  it("releases N deliveries of the event as one group", () => {
    const plan = run(draftOf(["a", "b"]), [{ concurrent: { event: "b", deliveries: 3 } }]);
    expect(view(plan)).toEqual([
      ["a", 1, "-", 0],
      ["b", 1, "g1", 0],
      ["b", 2, "g1", 0],
      ["b", 3, "g1", 0],
    ]);
    expect(new Set(plan.deliveries.slice(1).map((d) => d.event.id)).size).toBe(1);
  });

  it("names groups deterministically and joins an existing group", () => {
    const plan = run(draftOf(["a", "b"]), [
      { concurrent: { event: "a", deliveries: 2 } },
      { concurrent: { event: "b", deliveries: 2 } },
      { concurrent: { event: "a", deliveries: 2 } },
    ]);
    expect(plan.deliveries.map((d) => d.concurrencyGroup)).toEqual(["g1", "g1", "g1", "g2", "g2"]);
  });

  it("keeps a group contiguous when reorder splits it", () => {
    const plan = run(draftOf(["a", "x", "b"]), [
      { concurrent: { event: "a", deliveries: 2 } },
      { reorder: ["b", "a"] },
    ]);
    expect(plan.deliveries.map((d) => [d.event.type, d.concurrencyGroup ?? "-"])).toEqual([
      ["b", "-"],
      ["a", "g1"],
      ["a", "g1"],
      ["x", "-"],
    ]);
  });
});

describe("applyChaos errors", () => {
  it("rejects operators that target an event the flow never delivers", () => {
    try {
      run(draftOf(["invoice.paid"]), [{ duplicate: { event: "invoice.payed", times: 1 } }]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentChaosError);
      expect((error as PaymentChaosError).code).toBe("CONFIG_INVALID");
      expect((error as Error).message).toContain("invoice.paid");
    }
  });

  it("rejects unknown operators", () => {
    const bogus = { lostAck: { event: "a" } } as unknown as ChaosOperator;
    expect(() => run(draftOf(["a"]), [bogus])).toThrow(/Unknown chaos operator "lostAck"/);
  });

  it("does not mutate its input", () => {
    const draft = draftOf(["a", "b"]);
    const before = structuredClone(view(draft));
    run(draft, [{ concurrent: { event: "a", deliveries: 2 } }, { delay: { event: "a", byMs: 9 } }]);
    expect(view(draft)).toEqual(before);
  });
});

const typesArb = fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e"), {
  minLength: 2,
  maxLength: 5,
});

const opArb = (types: readonly string[]): fc.Arbitrary<ChaosOperator> => {
  const type = fc.constantFrom(...types);
  return fc.oneof(
    fc.record({ duplicate: fc.record({ event: type, times: fc.integer({ min: 1, max: 3 }) }) }),
    fc.record({ reorder: fc.shuffledSubarray([...types], { minLength: 2 }) }),
    fc.record({ delay: fc.record({ event: type, byMs: fc.integer({ min: 0, max: 1000 }) }) }),
    fc.record({
      concurrent: fc.record({ event: type, deliveries: fc.integer({ min: 2, max: 4 }) }),
    }),
  );
};

const scenarioArb = typesArb.chain((types) =>
  fc.record({
    types: fc.constant(types),
    chaos: fc.array(opArb(types), { maxLength: 6 }),
    seed: fc.nat(),
  }),
);

describe("operator properties", () => {
  it("duplicate never drops a logical event and adds exactly `times` per matching event", () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 1, max: 4 }), ({ types, chaos, seed }, times) => {
        const before = run(draftOf(types, seed), chaos);
        const event = types[0] as string;
        const after = run(before, [{ duplicate: { event, times } }]);
        expect(new Set(ids(after.deliveries))).toEqual(new Set(ids(before.deliveries)));
        const matching = new Set(
          before.deliveries.filter((d) => d.event.type === event).map((d) => d.event.id),
        );
        expect(after.deliveries.length).toBe(before.deliveries.length + matching.size * times);
      }),
    );
  });

  it("reorder and delay preserve the delivery multiset", () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(1000), ({ types, chaos, seed }, byMs) => {
        const before = run(draftOf(types, seed), chaos);
        const reordered = run(before, [{ reorder: [...types].reverse() }]);
        const delayed = run(before, [{ delay: { event: types[1] as string, byMs } }]);
        expect(sorted(ids(reordered.deliveries))).toEqual(sorted(ids(before.deliveries)));
        expect(sorted(ids(delayed.deliveries))).toEqual(sorted(ids(before.deliveries)));
      }),
    );
  });

  it("every chaos sequence yields a normalized plan", () => {
    fc.assert(
      fc.property(scenarioArb, ({ types, chaos, seed }) => {
        const plan = run(draftOf(types, seed), chaos);
        const ds = plan.deliveries;
        const attempts = new Map<string, number>();
        const closed = new Set<string>();
        ds.forEach((d, i) => {
          expect(d.seq).toBe(i);
          expect(d.attempt).toBe((attempts.get(d.event.id) ?? 0) + 1);
          attempts.set(d.event.id, d.attempt);
          if (i > 0)
            expect(d.sendOffsetMillis).toBeGreaterThanOrEqual(ds[i - 1]?.sendOffsetMillis ?? 0);
          const prevGroup = ds[i - 1]?.concurrencyGroup;
          if (prevGroup !== undefined && prevGroup !== d.concurrencyGroup) closed.add(prevGroup);
          if (d.concurrencyGroup !== undefined) expect(closed.has(d.concurrencyGroup)).toBe(false);
        });
        expect(new Set(ids(ds))).toEqual(new Set(ids(draftOf(types, seed).deliveries)));
      }),
    );
  });

  it("is a pure function of its inputs", () => {
    fc.assert(
      fc.property(scenarioArb, ({ types, chaos, seed }) => {
        expect(view(run(draftOf(types, seed), chaos))).toEqual(
          view(run(draftOf(types, seed), chaos)),
        );
      }),
    );
  });
});
