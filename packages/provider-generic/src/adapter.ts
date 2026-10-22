import { asEventId, type Env, PaymentChaosError, type ProviderAdapter } from "@paymentchaos/core";
import { parseParams } from "./config.ts";
import { messages } from "./messages.ts";
import { sign, verify } from "./signing.ts";

/** Configure once per scenario; frozen GenerateContext need not carry arbitrary params. */
export function createGenericAdapter(
  options: { env?: Env; params?: unknown } = {},
): ProviderAdapter {
  const env = options.env ?? process.env;
  // Unconfigured adapters support flow discovery; generation requires developer data.
  const configured = options.params === undefined ? undefined : parseParams(options.params);
  const params = () => configured ?? parseParams(undefined);
  return {
    id: "generic-hmac",
    displayName: messages.displayName,
    apiVersions: [],
    flows: [
      {
        id: "user-event",
        title: messages.flow,
        events: configured?.events.map((e) => e.type) ?? [],
      },
    ],
    // A configurable signer is not a provider. No provider timing claims apply.
    // Standard Webhooks describes 2xx success, but only recommends retry/timeout policies.
    // https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#delivery-success-and-failure
    deliveryProfile: {
      timeoutMillis: null,
      retryScheduleMillis: null,
      acceptedStatuses: Array.from({ length: 100 }, (_, i) => 200 + i),
      timestampFormat: "unix-seconds",
      ...(configured?.format === "standard-webhooks" ? { signatureToleranceSec: 300 } : {}),
    },
    redactionRules: [],
    generate(flow, ctx) {
      if (flow !== "user-event")
        throw new PaymentChaosError("CONFIG_INVALID", messages.unknownFlow);
      return params().events.map((event) => {
        const logical = {
          id: asEventId(ctx.ids.make("msg")),
          type: event.type,
          object: event.body,
          occurredAt: ctx.clock.now(),
        };
        ctx.clock.advance(1000);
        return logical;
      });
    },
    encode(event) {
      if (typeof event.object !== "string")
        throw new PaymentChaosError(
          "CONFIG_INVALID",
          messages.config("params.events.body: invalid_type"),
        );
      return Buffer.from(event.object, "utf8");
    },
    sign: (delivery, keys, at) => sign(delivery, keys, at, env, params().format),
    verify: (request, keys) => verify(request, keys, env, params().format),
    identify: () => null, // Arbitrary developer bytes have no provider envelope to identify.
  };
}
