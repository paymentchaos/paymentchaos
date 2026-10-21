import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { asInstant, asSecretRef } from "../contracts/index.ts";
import { createLogicalClock } from "../runtime/clock.ts";
import { createIdFactory } from "../runtime/ids.ts";
import { createRng } from "../runtime/rng.ts";
import { createFakeProvider, FAKE_SIGNATURE_HEADER } from "./fake-provider.ts";

const env = { FAKE_SECRET: "whsec_fake_current", FAKE_OLD: "whsec_fake_old" };
const keys = { current: asSecretRef("${FAKE_SECRET}") };
const provider = createFakeProvider({ env });

const generate = (seed: number, currency: string) => {
  const rng = createRng(seed);
  return provider.generate("subscription-renewal", {
    rng: rng.fork("generate"),
    ids: createIdFactory(rng.fork("ids")),
    clock: createLogicalClock(),
    currency,
  });
};

describe("fake provider", () => {
  it("encodes byte-stable, UTF-8, test-mode bodies", () => {
    fc.assert(
      fc.property(fc.nat(), fc.constantFrom("JPY", "INR", "BHD", "USD"), (seed, currency) => {
        const a = generate(seed, currency).map((e) => provider.encode(e, {}));
        const b = generate(seed, currency).map((e) => provider.encode(e, {}));
        expect(a.map((buf) => buf.toString("hex"))).toEqual(b.map((buf) => buf.toString("hex")));
        for (const body of a) {
          expect(body.toString("utf8")).toContain('"livemode":false');
        }
      }),
    );
  });

  it("uses currency minor units", () => {
    const amount = (currency: string) =>
      (generate(5, currency)[0]?.object as { amount: number } | undefined)?.amount ?? 0;
    expect(amount("JPY") * 1000).toBe(amount("BHD"));
    expect(amount("INR") * 10).toBe(amount("BHD"));
  });

  it("signs and verifies, and rejects corrupted signatures", () => {
    const [event] = generate(1, "JPY");
    if (event === undefined) throw new Error("no event");
    const body = provider.encode(event, {});
    const at = asInstant(1_767_225_600_000);
    const signed = provider.sign({ body, headers: {}, event }, keys, at);
    const request = {
      method: "POST",
      path: "/",
      headers: signed.headers,
      body: signed.body,
      receivedAt: at,
    };
    expect(provider.verify(request, keys)).toEqual({ valid: true, keyUsed: "current" });
    expect(provider.identify(request)).toEqual({
      provider: "fake",
      type: event.type,
      id: event.id,
    });

    const header = signed.headers[FAKE_SIGNATURE_HEADER] ?? "";
    const flipped = `${header.slice(0, -1)}${header.endsWith("0") ? "1" : "0"}`;
    const corrupted = { ...request, headers: { [FAKE_SIGNATURE_HEADER]: flipped } };
    expect(provider.verify(corrupted, keys).valid).toBe(false);
    expect(
      provider.verify({ ...request, body: Buffer.concat([body, Buffer.from(" ")]) }, keys).valid,
    ).toBe(false);
    expect(provider.verify({ ...request, receivedAt: asInstant(at + 301_000) }, keys).valid).toBe(
      false,
    );

    const rotated = { current: asSecretRef("${FAKE_OLD}"), previous: [keys.current] };
    expect(provider.verify(request, rotated)).toEqual({ valid: true, keyUsed: "previous" });
  });
});
