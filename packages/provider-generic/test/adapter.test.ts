import { createHmac, timingSafeEqual } from "node:crypto";
import { asEventId, asInstant, asSecretRef, compilePlan } from "@paymentchaos/core";
import fc from "fast-check";
import { Webhook } from "standardwebhooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenericAdapter } from "../src/index.ts";

const at = asInstant(1760000000000);
const env = {
  CURRENT: `whsec_${Buffer.alloc(32, 1).toString("base64")}`,
  OLD: `whsec_${Buffer.alloc(32, 2).toString("base64")}`,
};
const keys = { current: asSecretRef("${CURRENT}"), previous: [asSecretRef("${OLD}")] };
const body = '{ "name": "Zoë 東京 مرحبا", "test": true }\n';
const events = [
  { type: "custom.created", body },
  { type: "custom.updated", body: '{"test":true,"value":2}' },
];
const delivery = {
  body: Buffer.from(body),
  headers: {},
  event: { id: asEventId("msg_example"), type: "custom.created" },
};
const request = (bytes: Buffer, headers: Record<string, string>, receivedAt = at) => ({
  method: "POST",
  path: "/",
  body: bytes,
  headers,
  receivedAt,
});
afterEach(() => vi.useRealTimers());

describe("Standard Webhooks official SDK oracle", () => {
  it("verifies exact bytes with both rotated keys; rejects corrupt body/signature/secret/metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
    const adapter = createGenericAdapter({ env, params: { format: "standard-webhooks", events } });
    const signed = adapter.sign(delivery, keys, at);
    expect(signed.body).toBe(delivery.body);
    for (const secret of [env.CURRENT, env.OLD])
      expect(new Webhook(secret).verify(signed.body, signed.headers)).toEqual(JSON.parse(body));
    expect(adapter.verify(request(signed.body, signed.headers), keys)).toEqual({
      valid: true,
      keyUsed: "current",
    });
    expect(
      adapter.verify(request(signed.body, signed.headers), {
        current: keys.previous[0] ?? keys.current,
      }),
    ).toEqual({ valid: true, keyUsed: "current" });
    const sdk = new Webhook(env.CURRENT);
    expect(() =>
      sdk.verify(Buffer.concat([signed.body, Buffer.from(" ")]), signed.headers),
    ).toThrow();
    expect(() =>
      sdk.verify(signed.body, { ...signed.headers, "webhook-signature": "v1,broken" }),
    ).toThrow();
    expect(() =>
      new Webhook(`whsec_${Buffer.alloc(32, 3).toString("base64")}`).verify(
        signed.body,
        signed.headers,
      ),
    ).toThrow();
    for (const header of ["webhook-id", "webhook-timestamp"]) {
      const headers = {
        ...signed.headers,
        [header]: header === "webhook-id" ? "msg_wrong" : String(at / 1000 + 1),
      };
      expect(() => sdk.verify(signed.body, headers)).toThrow();
      expect(adapter.verify(request(signed.body, headers), keys).valid).toBe(false);
    }
  });
  it("verifies SDK-generated dotted identifiers without rewriting them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
    const adapter = createGenericAdapter({ env, params: { format: "standard-webhooks", events } });
    const sdk = new Webhook(env.CURRENT);
    const headers = {
      "webhook-id": "evt.1",
      "webhook-timestamp": String(at / 1000),
      "webhook-signature": sdk.sign("evt.1", new Date(at), delivery.body),
    };
    expect(() => sdk.verify(delivery.body, headers)).not.toThrow();
    expect(adapter.verify(request(delivery.body, headers), keys).valid).toBe(true);
  });
  it("matches SDK signatures and timestamp tolerance in both directions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
    const adapter = createGenericAdapter({ env, params: { format: "standard-webhooks", events } });
    const sdk = new Webhook(env.CURRENT);
    const signature = sdk.sign(delivery.event.id, new Date(at), delivery.body);
    const signed = adapter.sign(delivery, { current: keys.current }, at);
    expect(signed.headers["webhook-signature"]).toBe(signature);
    for (const seconds of [-301, -300, 300, 301]) {
      const receivedAt = asInstant(at + seconds * 1000);
      vi.setSystemTime(receivedAt);
      expect(adapter.verify(request(signed.body, signed.headers, receivedAt), keys).valid).toBe(
        Math.abs(seconds) <= 300,
      );
      if (Math.abs(seconds) <= 300)
        expect(() => sdk.verify(signed.body, signed.headers)).not.toThrow();
      else expect(() => sdk.verify(signed.body, signed.headers)).toThrow();
    }
  });
});

describe("configurable raw-byte HMAC", () => {
  const reference = (bytes: Buffer, signature: string, secret: string) => {
    const expected = createHmac("sha256", secret).update(bytes).digest();
    const passed = Buffer.from(signature, "hex");
    return passed.length === expected.length && timingSafeEqual(passed, expected);
  };
  it("raw-body-hex agrees with a timingSafeEqual reference for pass/corrupt cases", () => {
    const adapter = createGenericAdapter({ env, params: { format: "raw-body-hex", events } });
    const signed = adapter.sign(delivery, keys, at);
    const signature = signed.headers["x-webhook-signature"] ?? "";
    expect(reference(signed.body, signature, env.CURRENT)).toBe(true);
    expect(reference(Buffer.concat([signed.body, Buffer.from(" ")]), signature, env.CURRENT)).toBe(
      false,
    );
    expect(reference(signed.body, "0".repeat(64), env.CURRENT)).toBe(false);
    expect(reference(signed.body, signature, env.OLD)).toBe(false);
    expect(adapter.verify(request(signed.body, signed.headers), keys).valid).toBe(true);
    expect(
      adapter.verify(request(signed.body, { "x-webhook-signature": "é".repeat(64) }), keys).valid,
    ).toBe(false);
    expect(
      adapter.verify(
        request(signed.body, { ...signed.headers, "X-Webhook-Signature": signature }),
        keys,
      ).valid,
    ).toBe(false);
  });
  it.each(["sha256", "sha1", "sha512"] as const)(
    "supports %s with hex/base64, prefix and template",
    (algorithm) => {
      for (const encoding of ["hex", "base64"] as const) {
        const format = {
          header: "X-Signature",
          algorithm,
          encoding,
          prefix: `${algorithm}=`,
          template: "{id}.{timestamp}.{body}",
        };
        const adapter = createGenericAdapter({ env, params: { format, events } });
        const signed = adapter.sign({ ...delivery, headers: { "X-SIGNATURE": "stale" } }, keys, at);
        const expected = createHmac(algorithm, env.CURRENT)
          .update(`${delivery.event.id}.${at / 1000}.`)
          .update(delivery.body)
          .digest(encoding);
        expect(signed.headers["x-signature"]).toBe(`${algorithm}=${expected}`);
        expect(signed.body).toBe(delivery.body);
        expect(adapter.verify(request(signed.body, signed.headers), keys).valid).toBe(true);
        const old = adapter.sign(delivery, { current: keys.previous[0] ?? keys.current }, at);
        expect(adapter.verify(request(old.body, old.headers), keys)).toEqual({
          valid: true,
          keyUsed: "previous",
        });
      }
    },
  );
  it("preserves arbitrary bytes while signing templates", () => {
    fc.assert(
      fc.property(fc.uint8Array(), (bytes) => {
        const adapter = createGenericAdapter({ env, params: { events } });
        const payload = Buffer.from(bytes);
        const signed = adapter.sign({ ...delivery, body: payload }, keys, at);
        expect(signed.body).toBe(payload);
        expect(reference(payload, signed.headers["x-webhook-signature"] ?? "", env.CURRENT)).toBe(
          true,
        );
      }),
    );
  });
  it("generates byte-stable inline developer payloads and deterministic plan hashes", () => {
    const adapter = createGenericAdapter({ env, params: { events } });
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const scenario = {
          version: 1 as const,
          name: "generic",
          provider: "generic-hmac",
          flow: "user-event",
          params: { events },
          chaos: [],
          repeat: 1,
        };
        const a = compilePlan(scenario, adapter, { seed });
        const b = compilePlan(scenario, adapter, { seed });
        expect(a.plan.planHash).toBe(b.plan.planHash);
        expect([...a.bodies.values()]).toEqual(events.map((e) => Buffer.from(e.body)));
      }),
    );
  });
  it.each([
    {},
    { events, fromat: "standard-webhooks" },
    { events: [] },
    { events: [{ type: "x", body: {} }] },
    { events, format: { header: "x", algorithm: "md5", encoding: "hex", template: "{body}" } },
    ...["Content-Length", "webhook-id", "x-paymentchaos-mode", "bad\r\nheader"].map((header) => ({
      events,
      format: { header, algorithm: "sha256", encoding: "hex", template: "{body}" },
    })),
    {
      events,
      format: { header: "x", algorithm: "sha256", encoding: "hex", template: "{unknown}.{body}" },
    },
  ])("rejects invalid params with typed errors", (params) => {
    expect(() => createGenericAdapter({ params })).toThrowError(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        message: expect.stringContaining("params"),
      }),
    );
  });
  it("rejects invalid standard secrets and timestamps without echoing values", () => {
    const adapter = createGenericAdapter({
      env: { CURRENT: "secret-do-not-echo" },
      params: { format: "standard-webhooks", events },
    });
    expect(() => adapter.sign(delivery, { current: keys.current }, at)).toThrowError(
      expect.objectContaining({ code: "SIGNING_FAILED" }),
    );
    try {
      adapter.sign(delivery, keys, at);
    } catch (e) {
      expect(String(e)).not.toContain("secret-do-not-echo");
    }
    expect(() => adapter.sign(delivery, keys, asInstant(-1))).toThrowError(
      expect.objectContaining({ code: "SIGNING_FAILED" }),
    );
  });
});
