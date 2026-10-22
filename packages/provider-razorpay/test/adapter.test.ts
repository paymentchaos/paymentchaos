import {
  asEventId,
  asInstant,
  asSecretRef,
  compilePlan,
  createIdFactory,
  createLogicalClock,
  createRng,
} from "@paymentchaos/core";
import fc from "fast-check";
import { validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils.js";
import { describe, expect, it } from "vitest";
import { createRazorpayAdapter } from "../src/index.ts";

const env = { CURRENT: "synthetic-current-secret", OLD: "synthetic-old-secret" };
const keys = { current: asSecretRef("${CURRENT}"), previous: [asSecretRef("${OLD}")] };
const adapter = createRazorpayAdapter({ env });
const at = asInstant(1760000000000);
const delivery = {
  body: Buffer.from('{ "test": true, "name": "Zoë 東京 مرحبا" }\n'),
  headers: { "X-Razorpay-Signature": "stale" },
  event: { id: asEventId("evt_test"), type: "payment.captured" },
};
const request = (body: Buffer, headers: Record<string, string>) => ({
  method: "POST",
  path: "/",
  receivedAt: at,
  body,
  headers,
});

describe("Razorpay raw-byte signatures", () => {
  it("passes the official SDK; corrupt body, signature and secret fail the SDK", () => {
    const signed = adapter.sign(delivery, keys, at);
    const signature = signed.headers["x-razorpay-signature"] ?? "";
    expect(signed.body).toBe(delivery.body);
    expect(Object.keys(signed.headers)).toEqual(["x-razorpay-signature", "x-razorpay-event-id"]);
    expect(validateWebhookSignature(signed.body.toString("utf8"), signature, env.CURRENT)).toBe(
      true,
    );
    expect(
      validateWebhookSignature(`${signed.body.toString("utf8")} `, signature, env.CURRENT),
    ).toBe(false);
    expect(
      validateWebhookSignature(signed.body.toString("utf8"), "0".repeat(64), env.CURRENT),
    ).toBe(false);
    expect(validateWebhookSignature(signed.body.toString("utf8"), signature, env.OLD)).toBe(false);
    expect(adapter.verify(request(signed.body, signed.headers), keys)).toEqual({
      valid: true,
      keyUsed: "current",
    });
    expect(
      adapter.identify(
        request(Buffer.from('{"entity":"event","event":"payment.captured"}'), signed.headers),
      ),
    ).toEqual({ provider: "razorpay", type: "payment.captured", id: "evt_test" });
  });
  it("can sign an old retry and verify it with the previous secret", () => {
    const old = createRazorpayAdapter({ env, signingKey: "previous" }).sign(delivery, keys, at);
    expect(
      validateWebhookSignature(
        old.body.toString(),
        old.headers["x-razorpay-signature"] ?? "",
        env.OLD,
      ),
    ).toBe(true);
    expect(adapter.verify(request(old.body, old.headers), keys)).toEqual({
      valid: true,
      keyUsed: "previous",
    });
    expect(adapter.verify(request(old.body, old.headers), { current: keys.current }).valid).toBe(
      false,
    );
  });
  it.each([
    {},
    { "x-razorpay-signature": "xx" },
    { "x-razorpay-signature": "0".repeat(64), "X-Razorpay-Signature": "0".repeat(64) },
  ])("rejects missing/malformed/ambiguous headers", (headers) => {
    expect(adapter.verify(request(delivery.body, headers), keys).valid).toBe(false);
  });
});

describe("Razorpay synthesized payloads", () => {
  it.each([
    ["JPY", 100],
    ["INR", 10000],
    ["BHD", 100000],
  ])("uses %s integer minor units and documented relationships", (currency, amount) => {
    const rng = createRng(42);
    const ctx = {
      rng,
      ids: createIdFactory(rng),
      clock: createLogicalClock(at),
      currency: String(currency),
    };
    const [captured, paid] = adapter.generate("payment-captured", ctx);
    if (!captured || !paid) throw new Error("missing payment flow events");
    const a = JSON.parse(adapter.encode(captured, {}).toString());
    const b = JSON.parse(adapter.encode(paid, {}).toString());
    expect(a).toMatchObject({
      entity: "event",
      event: "payment.captured",
      contains: ["payment"],
      created_at: at / 1000,
      payload: {
        payment: {
          entity: {
            amount,
            currency,
            captured: true,
            notes: { paymentchaos: "synthetic-test", customer_name: "Zoë 東京 مرحبا" },
          },
        },
      },
    });
    expect(b.contains).toEqual(["payment", "order"]);
    expect(b.payload.order.entity.id).toBe(a.payload.payment.entity.order_id);
    expect(b.account_id).toBe(a.account_id);
    expect(b.payload.payment).toEqual(a.payload.payment);
    const [subscription] = adapter.generate("subscription-charged", ctx);
    if (!subscription) throw new Error("missing subscription event");
    const sub = JSON.parse(adapter.encode(subscription, {}).toString());
    expect(sub.contains).toEqual(["subscription", "payment"]);
    expect(sub.payload.subscription.entity.customer_id).toBe(
      sub.payload.payment.entity.customer_id,
    );
  });
  it("has deterministic bytes and plan hashes across seeds", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const scenario = {
          version: 1 as const,
          name: "test",
          provider: "razorpay",
          flow: "payment-captured",
          chaos: [],
          repeat: 1,
        };
        const a = compilePlan(scenario, adapter, { seed });
        const b = compilePlan(scenario, adapter, { seed });
        expect(a.plan.planHash).toBe(b.plan.planHash);
        expect([...a.bodies.values()]).toEqual([...b.bodies.values()]);
      }),
    );
  });
  it("rejects unsupported flows and versions", () => {
    const rng = createRng(1);
    const ctx = { rng, ids: createIdFactory(rng), clock: createLogicalClock(), currency: "INR" };
    expect(() => adapter.generate("missing", ctx)).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
    expect(() =>
      adapter.generate("payment-captured", { ...ctx, apiVersion: "invented" }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });
});
