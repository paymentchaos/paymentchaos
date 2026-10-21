import {
  asEventId,
  asInstant,
  asSecretRef,
  type CapturedRequest,
  type SigningKeySet,
} from "@paymentchaos/core";
import fc from "fast-check";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { sign, verify } from "../src/signing.ts";

const env = { CURRENT: "synthetic-current-key", OLD: "synthetic-previous-key" };
const keys: SigningKeySet = {
  current: asSecretRef("${CURRENT}"),
  previous: [asSecretRef("${OLD}")],
};
const at = asInstant(1_750_000_000_999);
const body = Buffer.from(' { "object" : "event", "metadata": {"name":"Zoë / 東京 / مرحبا"} }\n');
const event = { id: asEventId("evt_test"), type: "invoice.paid" };
const signed = (bytes = body, signingKeys = keys, timestamp = at) =>
  sign(
    { body: bytes, headers: { "Content-Type": "application/json" }, event },
    signingKeys,
    timestamp,
    env,
  );
const request = (header: string, bytes = body, receivedAt = at): CapturedRequest => ({
  method: "POST",
  path: "/webhooks",
  headers: { "Stripe-Signature": header },
  body: bytes,
  receivedAt,
});
const header = (bytes = body, signingKeys = keys, timestamp = at): string =>
  signed(bytes, signingKeys, timestamp).headers["stripe-signature"] ?? "";
const oracle = (bytes: Buffer, value: string, secret = env.CURRENT, receivedAt = at) =>
  Stripe.webhooks.constructEvent(bytes, value, secret, 300, undefined, receivedAt);

// Official verifier is the independent oracle; no duplicated expected HMAC calculation.
// https://github.com/stripe/stripe-node/blob/v18.5.0/src/Webhooks.ts
// These are deliberately synthetic secrets, never real endpoint credentials.
describe("Stripe raw-byte signer and SDK oracle", () => {
  it("preserves the Buffer, replaces header casing, and signs for both active keys", () => {
    const result = sign({ body, event, headers: { "Stripe-Signature": "old" } }, keys, at, env);
    expect(result.body).toBe(body);
    expect(Object.keys(result.headers)).toEqual(["stripe-signature"]);
    expect(oracle(body, header())).toHaveProperty("metadata.name", "Zoë / 東京 / مرحبا");
    expect(oracle(body, header(), env.OLD)).toHaveProperty("object", "event");
    expect(verify(request(header()), keys, env)).toEqual({ valid: true, keyUsed: "current" });
  });

  it("accepts a previous-only delivery and ignores unknown schemes/bad v1 candidates", () => {
    const oldHeader = header(body, { current: keys.previous?.[0] ?? keys.current });
    const value = `${oldHeader},v0=ignored,v1=bad`;
    expect(oracle(body, value, env.OLD)).toBeDefined();
    expect(verify(request(value), keys, env)).toEqual({ valid: true, keyUsed: "previous" });
  });

  it.each(["bytes", "signature", "secret", "reserialized"])(
    "rejects corrupted %s with both verifiers",
    (kind) => {
      let bytes = body;
      let value = header();
      let secret = env.CURRENT;
      if (kind === "bytes") bytes = Buffer.concat([body, Buffer.from(" ")]);
      if (kind === "signature") value = value.replace(/v1=[^,]+/g, `v1=${"0".repeat(64)}`);
      if (kind === "secret") secret = "synthetic-wrong-key";
      // Deliberate broken-consumer behavior: never used on the signing path.
      if (kind === "reserialized") bytes = Buffer.from(JSON.stringify(JSON.parse(body.toString())));
      expect(() => oracle(bytes, value, secret)).toThrow();
      const verificationEnv = kind === "secret" ? { CURRENT: secret, OLD: secret } : env;
      expect(verify(request(value, bytes), keys, verificationEnv).valid).toBe(false);
    },
  );

  it.each([0, 300, 301, -600])("matches SDK age semantics at %s seconds", (age) => {
    const receivedAt = asInstant(at + age * 1000);
    const value = header();
    expect(verify(request(value, body, receivedAt), keys, env).valid).toBe(age <= 300);
    if (age > 300) expect(() => oracle(body, value, env.CURRENT, receivedAt)).toThrow();
    else expect(oracle(body, value, env.CURRENT, receivedAt)).toBeDefined();
  });

  it.each(["", "t=1750000000", "v1=abc", "t=nope,v1=abc", "t=-1,v1=abc", "t=1750000000, v1=abc"])(
    "rejects malformed header %j",
    (value) => {
      expect(verify(request(value), keys, env).valid).toBe(false);
      expect(() => oracle(body, value)).toThrow();
    },
  );

  it("matches last-t and numeric-prefix SDK parsing", () => {
    const value = `t=1,${header().replace("t=1750000000", "t=1750000000suffix")}`;
    expect(oracle(body, value)).toBeDefined();
    expect(verify(request(value), keys, env).valid).toBe(true);
  });

  it("handles missing/ambiguous case variants and reports missing references safely", () => {
    expect(verify({ ...request(""), headers: {} }, keys, env).valid).toBe(false);
    expect(
      verify(
        {
          ...request(header()),
          headers: { "Stripe-Signature": header(), "stripe-signature": header() },
        },
        keys,
        env,
      ).valid,
    ).toBe(false);
    expect(() => signed(body, { current: asSecretRef("${MISSING}") })).toThrow(/MISSING/);
    expect(() => signed(body, keys, asInstant(Number.NaN))).toThrow(/timestamp/);
  });

  it("oracle-verifies arbitrary Unicode payloads and rejects appended bytes", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const bytes = Buffer.from(JSON.stringify({ text, name: "東京" }, null, 2));
        const value = header(bytes);
        expect(oracle(bytes, value)).toHaveProperty("text", text);
        expect(verify(request(value, bytes), keys, env).valid).toBe(true);
        expect(() => oracle(Buffer.concat([bytes, Buffer.from(" ")]), value)).toThrow();
      }),
      { numRuns: 50 },
    );
  });
});
