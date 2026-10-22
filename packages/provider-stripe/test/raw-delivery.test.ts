import { readFileSync } from "node:fs";
import {
  asSecretRef,
  compilePlan,
  executePlan,
  LOGICAL_EPOCH,
  scenarioSchema,
} from "@paymentchaos/core";
import { startRecordingServer } from "@paymentchaos/core/testing";
import Stripe from "stripe";
import { expect, it } from "vitest";
import { createStripeAdapter } from "../src/index.ts";

it("preserves a captured noncanonical fixture through the real signer and executor", async () => {
  const env = { STRIPE_TEST: "synthetic-stripe-endpoint-key" };
  const adapter = createStripeAdapter({ env });
  const scenario = scenarioSchema.parse({
    version: 1,
    name: "raw-body",
    provider: "stripe",
    flow: "subscription-renewal",
    params: { currency: "JPY", country: "JP" },
    chaos: [{ duplicate: { event: "invoice.paid", times: 1 } }],
  });
  const compiled = compilePlan(scenario, adapter, { seed: 1337 });
  const event = compiled.plan.deliveries[0]?.event;
  if (event === undefined) throw new Error("Missing test event");
  const fixture = readFileSync(
    new URL("../src/fixtures/noncanonical-renewal.fixture.json", import.meta.url),
  );
  expect(
    adapter.identify({
      method: "POST",
      path: "/",
      headers: {},
      body: fixture,
      receivedAt: LOGICAL_EPOCH,
    }),
  ).toMatchObject({ id: event.id, type: event.type });
  let rawBodyRejections = 0;
  const server = await startRecordingServer((request, response) => {
    const signature = request.headers["stripe-signature"] ?? "";
    Stripe.webhooks.constructEvent(
      request.body,
      signature,
      env.STRIPE_TEST,
      300,
      undefined,
      LOGICAL_EPOCH,
    );
    // Deliberate broken consumer: canonicalizing signed JSON invalidates raw fixtures.
    try {
      Stripe.webhooks.constructEvent(
        Buffer.from(JSON.stringify(JSON.parse(request.body.toString()))),
        signature,
        env.STRIPE_TEST,
        300,
        undefined,
        LOGICAL_EPOCH,
      );
    } catch {
      rawBodyRejections++;
    }
    response.writeHead(200).end();
  });
  try {
    const bodies = new Map(compiled.bodies);
    bodies.set(event.id, fixture);
    const result = await executePlan({ ...compiled, bodies }, adapter, {
      url: server.url,
      keys: { current: asSecretRef("${STRIPE_TEST}") },
      env,
      now: () => LOGICAL_EPOCH,
    });
    expect(result.deliveries.every((delivery) => delivery.accepted)).toBe(true);
    expect(server.requests.filter((request) => request.body.equals(fixture))).toHaveLength(2);
    expect(rawBodyRejections).toBe(2);
  } finally {
    await server.close();
  }
});
