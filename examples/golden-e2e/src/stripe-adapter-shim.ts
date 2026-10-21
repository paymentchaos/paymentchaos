/**
 * Bridge {@link ProviderAdapter} for golden tests until `@paymentchaos/provider-stripe`
 * exports `createStripeAdapter`. Event shapes follow `origin/m1/stripe-fixtures` generate.ts;
 * signing delegates to the real provider-stripe module.
 */
import {
  asEventId,
  type CapturedRequest,
  type Env,
  type FlowDescriptor,
  type GenerateContext,
  type Instant,
  type LogicalEvent,
  minorUnitsPerMajor,
  type ProviderAdapter,
  type SigningKeySet,
  type UnsignedDelivery,
} from "@paymentchaos/core";
import { sign, verify } from "../../../packages/provider-stripe/src/signing.ts";

const API_VERSION = "2025-08-27.basil";
const METADATA = {
  paymentchaos: "synthetic-test",
  customer_name: "Zoë 東京 مرحبا",
  note: "café / test",
} as const;

const FLOWS: readonly FlowDescriptor[] = [
  {
    id: "subscription-renewal",
    title: "Subscription renewal",
    events: ["invoice.paid", "customer.subscription.updated"],
  },
  {
    id: "cancellation-renewal-out-of-order",
    title: "Cancellation after renewal (out of order)",
    events: ["customer.subscription.deleted", "invoice.paid", "customer.subscription.updated"],
  },
];

function subscriptionObject(params: {
  id: string;
  customer: string;
  currency: string;
  status: string;
  created: number;
  invoiceId: string;
}): Record<string, unknown> {
  return {
    id: params.id,
    object: "subscription",
    customer: params.customer,
    currency: params.currency,
    status: params.status,
    created: params.created,
    metadata: METADATA,
    latest_invoice: params.invoiceId,
  };
}

function invoiceObject(params: {
  id: string;
  customer: string;
  currency: string;
  amount: number;
  created: number;
  subscriptionId: string;
}): Record<string, unknown> {
  return {
    id: params.id,
    object: "invoice",
    customer: params.customer,
    currency: params.currency,
    amount_paid: params.amount,
    total: params.amount,
    created: params.created,
    metadata: METADATA,
    subscription: params.subscriptionId,
  };
}

function generateRenewalLike(flow: string, ctx: GenerateContext): LogicalEvent[] {
  const currency = ctx.currency.toLowerCase();
  const amount = 990 * minorUnitsPerMajor(currency);
  const customer = ctx.ids.make("cus");
  const subscription = ctx.ids.make("sub");
  const invoice = ctx.ids.make("in");
  const events: LogicalEvent[] = [];
  const seconds = () => Math.floor(ctx.clock.now() / 1000);

  const emit = (type: string, object: Record<string, unknown>): void => {
    events.push({
      id: asEventId(ctx.ids.make("evt")),
      type,
      object,
      occurredAt: ctx.clock.now(),
    });
    ctx.clock.advance(1000);
  };

  if (flow === "cancellation-renewal-out-of-order") {
    const oldCanceled = ctx.ids.make("sub");
    emit(
      "customer.subscription.deleted",
      subscriptionObject({
        id: oldCanceled,
        customer,
        currency,
        status: "canceled",
        created: seconds() - 300,
        invoiceId: invoice,
      }),
    );
  }

  emit(
    "invoice.paid",
    invoiceObject({
      id: invoice,
      customer,
      currency,
      amount,
      created: seconds(),
      subscriptionId: subscription,
    }),
  );

  emit(
    "customer.subscription.updated",
    subscriptionObject({
      id: subscription,
      customer,
      currency,
      status: "active",
      created: seconds() - 60,
      invoiceId: invoice,
    }),
  );

  return events;
}

/** Canonical JSON that survives Express `json()` parse + `JSON.stringify` for the naive bug-4 demo. */
function encodeEvent(event: LogicalEvent, apiVersion: string): Buffer {
  const json = JSON.stringify({
    id: event.id,
    object: "event",
    api_version: apiVersion,
    created: Math.floor(event.occurredAt / 1000),
    type: event.type,
    livemode: false,
    data: { object: event.object },
  });
  return Buffer.from(json, "utf8");
}

export interface StripeAdapterShimOptions {
  readonly env?: Env;
}

export function createStripeAdapterShim(options: StripeAdapterShimOptions = {}): ProviderAdapter {
  const env = options.env ?? process.env;

  return {
    id: "stripe",
    displayName: "Stripe (golden shim)",
    apiVersions: [API_VERSION],
    flows: FLOWS,
    deliveryProfile: {
      timeoutMillis: null,
      retryScheduleMillis: null,
      signatureToleranceSec: 300,
      acceptedStatuses: [200, 201, 202, 204],
      timestampFormat: "unix-seconds",
    },
    redactionRules: [],

    generate(flow, ctx) {
      if (flow === "subscription-renewal" || flow === "cancellation-renewal-out-of-order") {
        return generateRenewalLike(flow, ctx);
      }
      throw new Error(`unsupported flow ${flow}`);
    },

    encode(event, encodeContext) {
      const apiVersion = encodeContext.apiVersion ?? API_VERSION;
      return encodeEvent(event, apiVersion);
    },

    sign(delivery: UnsignedDelivery, keys: SigningKeySet, at: Instant) {
      return sign(delivery, keys, at, env);
    },

    verify(request: CapturedRequest, keys: SigningKeySet) {
      return verify(request, keys, env);
    },

    identify(request: CapturedRequest) {
      if (request.headers["stripe-signature"] === undefined) {
        return null;
      }
      try {
        const parsed = JSON.parse(request.body.toString("utf8")) as {
          id?: unknown;
          type?: unknown;
        };
        if (typeof parsed.type !== "string") {
          return null;
        }
        return typeof parsed.id === "string"
          ? { provider: "stripe", type: parsed.type, id: parsed.id }
          : { provider: "stripe", type: parsed.type };
      } catch {
        return null;
      }
    },
  };
}
