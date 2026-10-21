import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CapturedRequest,
  type FlowDescriptor,
  type Instant,
  type LogicalEvent,
  minorUnitsPerMajor,
  type ProviderAdapter,
  type SigningKeySet,
  type UnsignedDelivery,
} from "../contracts/index.ts";
import { type Env, resolveSecret } from "../safety/secrets.ts";

/**
 * A contract-conforming test double for the engine and the CLI. It is NOT a real
 * provider and encodes no provider behaviour: signing is a Stripe-like
 * `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` header so tests exercise the same code
 * paths (fresh timestamps per attempt, rotation, raw-byte bodies) as real adapters.
 */

export const FAKE_SIGNATURE_HEADER = "fake-signature";

export interface FakeProviderOptions {
  /** Flow id → ordered event types. Defaults to {@link DEFAULT_FAKE_FLOWS}. */
  readonly flows?: Readonly<Record<string, readonly string[]>>;
  /** Where `${ENV_VAR}` secret references resolve. Defaults to `process.env`. */
  readonly env?: Env;
  readonly acceptedStatuses?: readonly number[];
  readonly timeoutMillis?: number;
}

export const DEFAULT_FAKE_FLOWS: Readonly<Record<string, readonly string[]>> = {
  "subscription-renewal": ["invoice.paid", "customer.subscription.updated"],
  "one-time-payment": ["payment_intent.succeeded", "checkout.session.completed"],
};

/** Non-ASCII names catch apps that verify a re-serialized body instead of raw bytes. */
const CUSTOMER_NAMES = ["Zoë Ångström", "山田太郎", "محمد", "Ñoño"] as const;
const TOLERANCE_SEC = 300;

const hmac = (secret: string, t: number, body: Buffer) =>
  createHmac("sha256", secret)
    .update(`${String(t)}.`)
    .update(body)
    .digest("hex");

export function createFakeProvider(options: FakeProviderOptions = {}): ProviderAdapter {
  const flowMap = options.flows ?? DEFAULT_FAKE_FLOWS;
  const env = options.env ?? process.env;
  const flows: FlowDescriptor[] = Object.entries(flowMap).map(([id, events]) => ({
    id,
    title: `Fake ${id}`,
    events,
  }));

  return {
    id: "fake",
    displayName: "Fake (test double)",
    apiVersions: ["2026-01-01"],
    flows,
    deliveryProfile: {
      timeoutMillis: options.timeoutMillis ?? 10_000,
      retryScheduleMillis: [60_000, 300_000],
      signatureToleranceSec: TOLERANCE_SEC,
      acceptedStatuses: options.acceptedStatuses ?? [200, 201, 202, 204],
      timestampFormat: "unix-seconds",
    },
    redactionRules: [{ path: "$.data.object.customer_name", strategy: "pseudonymize" }],

    generate(flow, ctx) {
      const types = flowMap[flow] ?? [];
      const currency = ctx.currency.toUpperCase();
      const customer = ctx.ids.make("cus");
      const subscription = ctx.ids.make("sub");
      const invoice = ctx.ids.make("in");
      const customerName = ctx.rng.pick(CUSTOMER_NAMES);
      const amount = (10 + ctx.rng.int(90)) * minorUnitsPerMajor(currency);
      return types.map((type): LogicalEvent => {
        const occurredAt = ctx.clock.now();
        ctx.clock.advance(1000);
        return {
          id: ctx.ids.make("evt") as LogicalEvent["id"],
          type,
          occurredAt,
          object: {
            customer,
            subscription,
            invoice,
            customer_name: customerName,
            amount,
            currency,
          },
        };
      });
    },

    encode(event) {
      // Deterministic bytes: fixed key order, UTF-8, unescaped non-ASCII, escaped "/".
      const json = JSON.stringify({
        id: event.id,
        object: "event",
        type: event.type,
        created: Math.floor(event.occurredAt / 1000),
        livemode: false,
        data: { object: event.object },
      }).replaceAll("/", "\\/");
      return Buffer.from(`${json}\n`, "utf8");
    },

    sign(delivery: UnsignedDelivery, keys: SigningKeySet, at: Instant) {
      const t = Math.floor(at / 1000);
      const signature = `t=${String(t)},v1=${hmac(resolveSecret(keys.current, env), t, delivery.body)}`;
      return {
        body: delivery.body,
        headers: { ...delivery.headers, [FAKE_SIGNATURE_HEADER]: signature },
      };
    },

    verify(request: CapturedRequest, keys: SigningKeySet) {
      const header = request.headers[FAKE_SIGNATURE_HEADER];
      const match = header === undefined ? null : /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
      if (match === null) return { valid: false, reason: "missing or malformed signature header" };
      const t = Number(match[1]);
      if (Math.abs(request.receivedAt / 1000 - t) > TOLERANCE_SEC) {
        return { valid: false, reason: "timestamp outside tolerance" };
      }
      const given = Buffer.from(match[2] ?? "", "hex");
      const candidates: Array<["current" | "previous", string]> = [
        ["current", resolveSecret(keys.current, env)],
        ...(keys.previous ?? []).map((ref): ["previous", string] => [
          "previous",
          resolveSecret(ref, env),
        ]),
      ];
      for (const [keyUsed, secret] of candidates) {
        if (timingSafeEqual(Buffer.from(hmac(secret, t, request.body), "hex"), given)) {
          return { valid: true, keyUsed };
        }
      }
      return { valid: false, reason: "signature mismatch" };
    },

    identify(request: CapturedRequest) {
      if (request.headers[FAKE_SIGNATURE_HEADER] === undefined) return null;
      try {
        // Read-only inspection of a captured body; never re-serialized or re-signed.
        const parsed = JSON.parse(request.body.toString("utf8")) as {
          id?: unknown;
          type?: unknown;
        };
        if (typeof parsed.type !== "string") return null;
        return typeof parsed.id === "string"
          ? { provider: "fake", type: parsed.type, id: parsed.id }
          : { provider: "fake", type: parsed.type };
      } catch {
        return null;
      }
    },
  };
}
