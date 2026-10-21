import { readFileSync } from "node:fs";
import {
  asEventId,
  asSecretRef,
  compilePlan,
  LOGICAL_EPOCH,
  type Scenario,
  scenarioSchema,
} from "@paymentchaos/core";
import fc from "fast-check";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { createStripeAdapter } from "../src/index.ts";

const env = { STRIPE_TEST: "synthetic-stripe-endpoint-key" };
const keys = { current: asSecretRef("${STRIPE_TEST}") };
const adapter = createStripeAdapter({ env });
const scenario = (flow = "subscription-renewal", currency = "USD", country = "US"): Scenario =>
  scenarioSchema.parse({
    version: 1,
    name: "test",
    provider: "stripe",
    flow,
    params: { currency, country },
    chaos: [],
  });
function events(flow = "subscription-renewal", currency = "USD", country = "US") {
  const compiled = compilePlan(scenario(flow, currency, country), adapter, { seed: 1337 });
  const payloads = compiled.plan.deliveries.map(({ event }) => {
    const body = compiled.bodies.get(event.id);
    if (body === undefined) throw new Error("Missing compiled test bytes");
    const signed = adapter.sign({ body, headers: {}, event }, keys, LOGICAL_EPOCH);
    const signature = signed.headers["stripe-signature"] ?? "";
    return Stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_TEST,
      300,
      undefined,
      LOGICAL_EPOCH,
    );
  });
  return { compiled, payloads };
}

describe("Stripe lifecycle adapter", () => {
  it("exports only the factory, pins API provenance, and leaves unknown timing null", async () => {
    expect(Object.keys(await import("../src/index.ts"))).toEqual(["createStripeAdapter"]);
    expect(adapter.apiVersions).toEqual(["2025-08-27.basil"]);
    expect(adapter.deliveryProfile).toMatchObject({
      timeoutMillis: null,
      retryScheduleMillis: null,
      signatureToleranceSec: 300,
    });
    expect(adapter.deliveryProfile.acceptedStatuses).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 200),
    );
  });

  it.each(adapter.flows)("generates truthful test envelopes for $id in logical order", (flow) => {
    const { compiled, payloads } = events(flow.id);
    expect(payloads.map((event) => event.type)).toEqual(flow.events);
    expect(payloads.map((event) => event.created)).toEqual(
      [...payloads.map((event) => event.created)].sort(),
    );
    expect(new Set(payloads.map((event) => event.id)).size).toBe(payloads.length);
    for (const payload of payloads) {
      expect(payload).toMatchObject({
        object: "event",
        livemode: false,
        api_version: adapter.apiVersions[0],
      });
      expect(payload.data.object).toHaveProperty("livemode", false);
      expect(payload.data.object).toHaveProperty("metadata.customer_name", "Zoë 東京 مرحبا");
      expect(JSON.stringify(payload)).not.toContain("_template");
      const bytes = compiled.bodies.get(asEventId(payload.id));
      expect(bytes?.toString()).toBe(JSON.stringify(payload));
    }
    for (const id of Object.values(compiled.ids)) expect(id).toMatch(/^[a-z]+_[A-Za-z0-9]{16}$/);
  });

  it("never resurrects a canceled subscription; the CLI can deliver its cancellation last", () => {
    const { payloads, compiled } = events("cancellation-renewal-out-of-order");
    const old = payloads.find((event) => event.type === "customer.subscription.deleted");
    const active = payloads.find((event) => event.type === "customer.subscription.updated");
    if (
      old?.type !== "customer.subscription.deleted" ||
      active?.type !== "customer.subscription.updated"
    )
      throw new Error("Missing lifecycle events");
    expect(old.data.object.id).not.toBe(active.data.object.id);
    expect(old.data.object.created).toBeLessThan(active.data.object.created);
    expect(old.created).toBeLessThan(active.created);
    expect(old.data.object.status).toBe("canceled");
    expect(old.data.object.customer).toBe(active.data.object.customer);
    expect(old.data.object.items.data[0]?.subscription).toBe(old.data.object.id);
    const reordered = compilePlan(
      {
        ...scenario("cancellation-renewal-out-of-order"),
        chaos: [
          {
            reorder: [
              "invoice.paid",
              "customer.subscription.updated",
              "customer.subscription.deleted",
            ],
          },
        ],
      },
      adapter,
      { seed: 1337 },
    );
    expect(reordered.plan.deliveries.at(-1)?.event.id).toBe(old.id);
    expect(reordered.ids).toEqual(compiled.ids);
  });

  it("preserves deterministic hashes and exact bytes with duplicate/reorder/concurrent chaos", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom(...adapter.flows.map((f) => f.id)),
        (seed, flow) => {
          const target = flow === "one-time-payment" ? "payment_intent.succeeded" : "invoice.paid";
          const s = {
            ...scenario(flow),
            chaos: [
              { duplicate: { event: target, times: 2 } },
              { concurrent: { event: target, deliveries: 3 } },
              {
                reorder: [
                  ...(adapter.flows.find((entry) => entry.id === flow)?.events ?? []),
                ].reverse(),
              },
            ],
          };
          const a = compilePlan(s, adapter, { seed });
          const b = compilePlan(s, adapter, { seed });
          expect(a).toEqual(b);
          expect(compilePlan(s, adapter, { seed, nonce: "Nonce123" }).plan.planHash).toBe(
            a.plan.planHash,
          );
          expect(compilePlan(s, adapter, { seed: seed + 1 }).plan.planHash).not.toBe(
            a.plan.planHash,
          );
        },
      ),
      { numRuns: 30 },
    );
  });

  it("identifies events without treating identification as authentication", () => {
    const { compiled } = events();
    for (const { event } of compiled.plan.deliveries) {
      const request = {
        method: "POST",
        path: "/",
        headers: {},
        body: compiled.bodies.get(event.id) ?? Buffer.alloc(0),
        receivedAt: LOGICAL_EPOCH,
      };
      expect(adapter.identify(request)).toEqual({
        provider: "stripe",
        type: event.type,
        id: event.id,
      });
      expect(adapter.verify(request, keys).valid).toBe(false);
    }
    for (const value of ["null", "{}", "[1]", "broken", '{"object":"payment_intent"}']) {
      expect(
        adapter.identify({
          method: "POST",
          path: "/",
          headers: {},
          body: Buffer.from(value),
          receivedAt: LOGICAL_EPOCH,
        }),
      ).toBeNull();
    }
  });

  it("planning reads no wall clock or platform randomness", () => {
    for (const file of ["generate.ts", "adapter.ts", "version.ts"]) {
      expect(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).not.toMatch(
        /Math\.random|Date\.now|new Date\b|performance\.now/,
      );
    }
  });
});
