import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ChaosOperator,
  type ProviderAdapter,
  type Scenario,
  scenarioSchema,
} from "../contracts/index.ts";
import { createRunNonce } from "../runtime/ids.ts";
import { createFakeProvider } from "../testing/fake-provider.ts";
import { compilePlan } from "./compile.ts";

const scenario = (overrides: Partial<Scenario> = {}): Scenario =>
  scenarioSchema.parse({
    version: 1,
    name: "renewal",
    provider: "fake",
    flow: "subscription-renewal",
    params: { currency: "jpy", country: "jp" },
    chaos: [
      { duplicate: { event: "invoice.paid", times: 2 } },
      { reorder: ["customer.subscription.updated", "invoice.paid"] },
      { concurrent: { event: "invoice.paid", deliveries: 3 } },
      { delay: { event: "customer.subscription.updated", byMs: 250 } },
    ],
    ...overrides,
  });

const fake = createFakeProvider();
const compile = (s: Scenario, seed: number, nonce?: string, adapter: ProviderAdapter = fake) =>
  compilePlan(s, adapter, nonce === undefined ? { seed } : { seed, nonce });

describe("compilePlan", () => {
  it("is pinned: a changed hash for this scenario is a breaking change (ADR 0003)", () => {
    const { plan } = compile(scenario(), 1337);
    expect(plan.planHash).toMatchInlineSnapshot(
      `"83c9d03ef559f89fab920acb72183b17538f1d8c33bd1a40d81a93a6222387c8"`,
    );
    expect(
      plan.deliveries.map((d) => [
        d.seq,
        d.event.type,
        d.attempt,
        d.concurrencyGroup ?? "-",
        d.sendOffsetMillis,
        d.chaosTags.join("+"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          0,
          "invoice.paid",
          1,
          "g1",
          0,
          "reorder+concurrent",
        ],
        [
          1,
          "invoice.paid",
          2,
          "g1",
          0,
          "reorder+concurrent",
        ],
        [
          2,
          "invoice.paid",
          3,
          "g1",
          0,
          "reorder+concurrent",
        ],
        [
          3,
          "invoice.paid",
          4,
          "-",
          0,
          "duplicate+reorder",
        ],
        [
          4,
          "invoice.paid",
          5,
          "-",
          0,
          "duplicate+reorder",
        ],
        [
          5,
          "customer.subscription.updated",
          1,
          "-",
          250,
          "reorder+delay",
        ],
      ]
    `);
  });

  it("gives the same plan hash for the same seed, nonce or not", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const stable = compile(scenario(), seed);
        const a = compile(scenario(), seed, createRunNonce());
        const b = compile(scenario(), seed, createRunNonce());
        expect(a.plan.planHash).toBe(stable.plan.planHash);
        expect(b.plan.planHash).toBe(stable.plan.planHash);
        expect(a.plan.deliveries[0]?.event.id).not.toBe(b.plan.deliveries[0]?.event.id);
      }),
      { numRuns: 50 },
    );
  });

  it("gives the same hash for arbitrary flows and chaos with the same seed", () => {
    const types = ["a.created", "b.paid", "c.updated"];
    const op = fc.oneof(
      fc.record({
        duplicate: fc.record({
          event: fc.constantFrom(...types),
          times: fc.integer({ min: 1, max: 3 }),
        }),
      }),
      fc.record({ delay: fc.record({ event: fc.constantFrom(...types), byMs: fc.nat(5000) }) }),
      fc.record({
        concurrent: fc.record({
          event: fc.constantFrom(...types),
          deliveries: fc.integer({ min: 2, max: 4 }),
        }),
      }),
      fc.record({ reorder: fc.shuffledSubarray(types, { minLength: 2 }) }),
    ) as fc.Arbitrary<ChaosOperator>;
    const adapter = createFakeProvider({ flows: { f: types } });
    fc.assert(
      fc.property(fc.integer(), fc.array(op, { maxLength: 5 }), (seed, chaos) => {
        const s = scenario({ flow: "f", chaos });
        expect(compile(s, seed, undefined, adapter).plan.planHash).toBe(
          compile(s, seed, createRunNonce(), adapter).plan.planHash,
        );
      }),
      { numRuns: 50 },
    );
  });

  it("changes the hash when the seed, chaos, flow params or apiVersion change", () => {
    const base = compile(scenario(), 1).plan.planHash;
    expect(compile(scenario(), 2).plan.planHash).not.toBe(base);
    expect(compile(scenario({ chaos: [] }), 1).plan.planHash).not.toBe(base);
    expect(compile(scenario({ params: { currency: "bhd" } }), 1).plan.planHash).not.toBe(base);
    const twoVersions = { ...fake, apiVersions: ["2026-01-01", "2026-06-01"] };
    expect(
      compile(scenario({ apiVersion: "2026-06-01" }), 1, undefined, twoVersions).plan.planHash,
    ).not.toBe(base);
  });

  it("ignores where the plan is sent and how it is judged", () => {
    const base = compile(scenario(), 1).plan.planHash;
    const elsewhere = scenario({
      target: { url: "http://localhost:9999/x", secret: "${OTHER}" },
      assert: { command: "true" },
      repeat: 20,
      name: "renamed",
    });
    expect(compile(elsewhere, 1).plan.planHash).toBe(base);
  });

  it("encodes each logical event once and passes currency, country and ids through", () => {
    const compiled = compile(scenario(), 7, "Nonce123");
    const eventIds = new Set(compiled.plan.deliveries.map((d) => d.event.id));
    expect([...compiled.bodies.keys()].sort()).toEqual([...eventIds].sort());
    const body = compiled.bodies.get(compiled.plan.deliveries[0]?.event.id ?? ("" as never));
    expect(body?.toString("utf8")).toContain('"currency":"JPY"');
    expect(compiled.ids.customer).toMatch(/^cus_Nonce123[0-9A-Za-z]{16}$/);
    expect(compiled.apiVersion).toBe("2026-01-01");
  });

  it.each([
    [{ provider: "stripe" }, /compiled with the "fake" adapter/],
    [{ flow: "nope" }, /no flow "nope".*subscription-renewal/],
    [{ apiVersion: "1999-01-01" }, /does not support apiVersion/],
  ] as const)("rejects %o with CONFIG_INVALID", (overrides, message) => {
    expect(() => compile(scenario(overrides), 1)).toThrow(message);
  });

  it("rejects adapters whose encode is not byte-stable", () => {
    let calls = 0;
    const flaky = { ...fake, encode: () => Buffer.from(String(calls++)) };
    expect(() => compile(scenario({ chaos: [] }), 1, undefined, flaky)).toThrow(
      /not.*deterministic|different bytes/,
    );
  });
});

describe("determinism guard", () => {
  it("planning code never reads the wall clock or the platform RNG", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "..");
    const planning = ["plan", "operators"].flatMap((dir) =>
      readdirSync(join(src, dir)).map((file) => join(src, dir, file)),
    );
    planning.push(join(src, "runtime", "rng.ts"), join(src, "runtime", "clock.ts"));
    for (const file of planning.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /Math\.random|Date\.now|new Date\b|performance\.now/,
      );
    }
  });
});
