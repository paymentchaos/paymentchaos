import { createHmac, timingSafeEqual } from "node:crypto";
import { type Env, type ProviderAdapter, resolveSecret } from "@paymentchaos/core";
import { generate } from "./generate.ts";
import { messages } from "./messages.ts";

export function createRazorpayAdapter(
  options: { env?: Env; signingKey?: "current" | "previous" } = {},
): ProviderAdapter {
  const env = options.env ?? process.env;
  // Exact raw-body HMAC, one signature. Older retries retain the old secret:
  // https://razorpay.com/docs/webhooks/validate-test/#validate-webhooks
  const digest = (body: Buffer, secret: string) =>
    createHmac("sha256", secret).update(body).digest("hex");
  return {
    id: "razorpay",
    displayName: messages.displayName,
    apiVersions: [],
    flows: [
      {
        id: "subscription-charged",
        title: messages.subscription,
        events: ["subscription.charged"],
      },
      {
        id: "payment-captured",
        title: messages.payment,
        events: ["payment.captured", "order.paid"],
      },
    ],
    // Non-2xx retries use exponential backoff for 24h; exact intervals unpublished.
    // A response taking >5 seconds times out. Local execution budget is separate.
    // https://razorpay.com/docs/webhooks/best-practices/
    deliveryProfile: {
      timeoutMillis: 5000,
      retryScheduleMillis: null,
      acceptedStatuses: Array.from({ length: 100 }, (_, i) => 200 + i),
      timestampFormat: "unix-seconds",
    },
    redactionRules: [
      { path: "$.payload.order.entity.notes", strategy: "remove" },
      { path: "$.payload.payment.entity.card.name", strategy: "pseudonymize" },
      { path: "$.payload.payment.entity.email", strategy: "pseudonymize" },
      { path: "$.payload.payment.entity.contact", strategy: "pseudonymize" },
      { path: "$.payload.payment.entity.notes", strategy: "remove" },
      { path: "$.payload.subscription.entity.notes", strategy: "remove" },
    ],
    generate,
    encode: (event) => Buffer.from(JSON.stringify(event.object), "utf8"),
    sign(delivery, keys) {
      const key =
        options.signingKey === "previous" ? (keys.previous?.[0] ?? keys.current) : keys.current;
      const headers = Object.fromEntries(
        Object.entries(delivery.headers).filter(
          ([k]) => !["x-razorpay-signature", "x-razorpay-event-id"].includes(k.toLowerCase()),
        ),
      );
      return {
        body: delivery.body,
        headers: {
          ...headers,
          "x-razorpay-signature": digest(delivery.body, resolveSecret(key, env)),
          "x-razorpay-event-id": delivery.event.id,
        },
      };
    },
    verify(request, keys) {
      const headers = Object.entries(request.headers).filter(
        ([k]) => k.toLowerCase() === "x-razorpay-signature",
      );
      const signature = headers[0]?.[1] ?? "";
      if (headers.length !== 1 || !/^[a-f0-9]{64}$/.test(signature))
        return { valid: false, reason: messages.mismatch };
      for (const [i, ref] of [keys.current, ...(keys.previous ?? [])].entries()) {
        if (
          timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(digest(request.body, resolveSecret(ref, env))),
          )
        )
          return { valid: true, keyUsed: i === 0 ? "current" : "previous" };
      }
      return { valid: false, reason: messages.mismatch };
    },
    identify(request) {
      try {
        const value: unknown = JSON.parse(request.body.toString("utf8"));
        if (
          value === null ||
          typeof value !== "object" ||
          !("entity" in value) ||
          value.entity !== "event" ||
          !("event" in value) ||
          typeof value.event !== "string"
        )
          return null;
        const id = Object.entries(request.headers).find(
          ([k]) => k.toLowerCase() === "x-razorpay-event-id",
        )?.[1];
        return { provider: "razorpay", type: value.event, ...(id === undefined ? {} : { id }) };
      } catch {
        return null;
      }
    },
  };
}
