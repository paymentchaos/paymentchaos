import type { Env, ProviderAdapter } from "@paymentchaos/core";
import type Stripe from "stripe";
import { generate } from "./generate.ts";
import { messages } from "./messages.ts";
import { SIGNATURE_TOLERANCE_SEC, sign, verify } from "./signing.ts";
import { API_VERSION, checkVersion } from "./version.ts";

export function createStripeAdapter(options: { env?: Env } = {}): ProviderAdapter {
  const env = options.env ?? process.env;
  return {
    id: "stripe",
    displayName: messages.displayName,
    apiVersions: [API_VERSION],
    flows: [
      {
        id: "subscription-renewal",
        title: messages.renewal,
        events: ["invoice.paid", "customer.subscription.updated"],
      },
      {
        id: "cancellation-renewal-out-of-order",
        title: messages.cancellation,
        events: ["customer.subscription.deleted", "invoice.paid", "customer.subscription.updated"],
      },
      {
        id: "one-time-payment",
        title: messages.payment,
        events: ["payment_intent.succeeded", "checkout.session.completed"],
      },
    ],
    // https://docs.stripe.com/webhooks#automatic-retries — sandbox: three retries over
    // a few hours; live: up to three days, exponential backoff. Exact intervals and
    // provider timeout are unpublished (ADR0009); M1 retries are scenario-controlled.
    deliveryProfile: {
      timeoutMillis: null,
      retryScheduleMillis: null,
      signatureToleranceSec: SIGNATURE_TOLERANCE_SEC,
      // https://docs.stripe.com/webhooks#quickly-return-a-2xx-response
      acceptedStatuses: Array.from({ length: 100 }, (_, index) => 200 + index),
      timestampFormat: "unix-seconds",
    },
    redactionRules: [
      { path: "$.data.object.customer_email", strategy: "pseudonymize" },
      { path: "$.data.object.customer_name", strategy: "pseudonymize" },
      { path: "$.data.object.customer_phone", strategy: "pseudonymize" },
      { path: "$.data.object.customer_address", strategy: "remove" },
      { path: "$.data.object.customer_details", strategy: "remove" },
      { path: "$.data.object.client_secret", strategy: "remove" },
      { path: "$.data.object.metadata", strategy: "remove" },
      { path: "$.data.object.parent.subscription_details.metadata", strategy: "remove" },
      { path: "$.data.object.items.data[*].metadata", strategy: "remove" },
      { path: "$.data.object.lines.data[*].metadata", strategy: "remove" },
    ],
    generate,
    encode(event, ctx) {
      checkVersion(ctx.apiVersion);
      // The object snapshot is opaque at the frozen encode seam. Every generated
      // snapshot satisfies its full SDK resource type at construction in generate.ts.
      const envelope = {
        id: event.id,
        object: "event",
        api_version: API_VERSION,
        created: Math.floor(event.occurredAt / 1000),
        data: { object: event.object },
        livemode: false,
        pending_webhooks: 1,
        request: null,
        type: event.type,
      } satisfies Omit<Stripe.Event, "data" | "type"> & { data: { object: unknown }; type: string };
      return Buffer.from(JSON.stringify(envelope), "utf8");
    },
    sign: (delivery, keys, at) => sign(delivery, keys, at, env),
    verify: (request, keys) => verify(request, keys, env),
    identify(request) {
      // Inspection is separate from signing: this never modifies signed bytes and
      // establishes shape only, not authenticity. Call verify for authentication.
      try {
        const value: unknown = JSON.parse(request.body.toString("utf8"));
        if (
          value === null ||
          typeof value !== "object" ||
          !("object" in value) ||
          value.object !== "event" ||
          !("id" in value) ||
          typeof value.id !== "string" ||
          !value.id.startsWith("evt_") ||
          !("type" in value) ||
          typeof value.type !== "string"
        )
          return null;
        return { provider: "stripe", id: value.id, type: value.type };
      } catch {
        return null;
      }
    },
  };
}
