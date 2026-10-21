import type { Delivery, DeliveryPlan, RunReport, Scenario } from "@paymentchaos/core";
import { asEventId, asInstant, PaymentChaosError } from "@paymentchaos/core";
import { assertTargetAllowed } from "./target-guard.ts";
import type {
  FlowListing,
  PaymentChaosEngine,
  PlanEngineOptions,
  RunEngineOptions,
} from "./types.ts";

const STATIC_FLOWS: readonly FlowListing[] = [
  {
    provider: "stripe",
    id: "subscription-renewal",
    title: "Subscription renewal",
    events: ["invoice.paid", "customer.subscription.updated"],
  },
  {
    provider: "stripe",
    id: "cancellation-renewal-out-of-order",
    title: "Cancellation after renewal (out of order)",
    events: ["invoice.paid", "customer.subscription.deleted"],
  },
  {
    provider: "stripe",
    id: "one-time-payment",
    title: "One-time payment",
    events: ["payment_intent.succeeded", "checkout.session.completed"],
  },
  {
    provider: "razorpay",
    id: "subscription-charged",
    title: "Subscription charged",
    events: ["subscription.charged"],
  },
  {
    provider: "razorpay",
    id: "payment-captured",
    title: "Payment captured",
    events: ["payment.captured", "order.paid"],
  },
  {
    provider: "generic-hmac",
    id: "user-event",
    title: "User-supplied HMAC event",
    events: ["custom.event"],
  },
];

function fakePlanHash(seed: number, scenario: Scenario): string {
  const base = `${seed}:${scenario.provider}:${scenario.flow}:${scenario.chaos.length}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function compileFakeDeliveries(scenario: Scenario): Delivery[] {
  const tagsFor = (index: number): string[] => {
    const op = scenario.chaos[index];
    if (op === undefined) {
      return [];
    }
    if ("duplicate" in op) {
      return ["duplicate"];
    }
    if ("reorder" in op) {
      return ["reorder"];
    }
    if ("delay" in op) {
      return ["delay"];
    }
    if ("concurrent" in op) {
      return ["concurrent"];
    }
    return [];
  };

  const deliveries: Delivery[] = [];
  let seq = 1;
  const baseEvents = STATIC_FLOWS.find(
    (f) => f.provider === scenario.provider && f.id === scenario.flow,
  )?.events ?? ["invoice.paid"];

  for (const eventType of baseEvents) {
    deliveries.push({
      seq,
      attempt: 1,
      event: {
        id: asEventId(`evt_fake_${seq}`),
        type: eventType,
        object: {},
        occurredAt: asInstant(0),
      },
      sendOffsetMillis: seq * 10,
      chaosTags: tagsFor(0),
    });
    seq += 1;
  }

  for (const op of scenario.chaos) {
    if ("duplicate" in op) {
      const times = op.duplicate.times;
      for (let t = 0; t < times; t++) {
        deliveries.push({
          seq,
          attempt: t + 2,
          event: {
            id: asEventId(`evt_fake_dup_${seq}`),
            type: op.duplicate.event,
            object: {},
            occurredAt: asInstant(0),
          },
          sendOffsetMillis: seq * 10,
          chaosTags: ["duplicate"],
        });
        seq += 1;
      }
    }
  }

  return deliveries;
}

function buildRunReport(options: RunEngineOptions, status: RunReport["status"]): RunReport {
  const planHash = fakePlanHash(options.seed, options.scenario);
  const startedAt = "1970-01-01T00:00:00.000Z";
  const finishedAt = "1970-01-01T00:00:01.000Z";
  const deliveries = compileFakeDeliveries(options.scenario).map((d, index) => ({
    seq: d.seq,
    attempt: d.attempt,
    eventType: d.event.type,
    eventId: d.event.id,
    statusCode: status === "error" ? undefined : 200,
    latencyMs: 12 + index,
    chaosTags: [...d.chaosTags],
    ...(status === "error" && index === 0 ? { error: "connection refused" } : {}),
  }));

  const failedAssertion =
    options.scenario.name.includes("renewal") && options.seed === 1337 && status !== "passed";

  const assertions = failedAssertion
    ? [
        {
          name: "entitlements",
          pass: false,
          expected: 1,
          observed: 2,
          message: "Duplicate invoice.paid delivery created two entitlement records.",
        },
      ]
    : [{ name: "command", pass: true }];

  const repeatsFailed = failedAssertion ? 1 : 0;

  return {
    schemaVersion: 1,
    runId: "run_fake",
    seed: options.seed,
    planHash,
    provider: options.scenario.provider,
    scenario: options.scenario.name,
    startedAt,
    finishedAt,
    repeat: options.repeat,
    repeatsFailed,
    status: failedAssertion ? "failed" : status,
    deliveries,
    assertions,
  };
}

/** Contract-conforming stub used until the core engine is wired in. */
export function createFakeEngine(): PaymentChaosEngine {
  return {
    async run(options: RunEngineOptions): Promise<RunReport> {
      const targetUrl = options.scenario.target?.url;
      if (targetUrl === undefined) {
        throw new PaymentChaosError("CONFIG_INVALID", "Scenario is missing target.url");
      }
      assertTargetAllowed(targetUrl, options.allowRemoteTarget);

      if (options.repeatIndex !== undefined && options.repeat > 1) {
        // Deterministic stub: only repeat index 4 fails for seed 1337 demo.
        if (options.seed === 1337 && options.repeatIndex === 4) {
          return buildRunReport(options, "failed");
        }
        return buildRunReport(options, "passed");
      }

      if (targetUrl.includes("unreachable.test")) {
        throw new PaymentChaosError("TARGET_UNREACHABLE", "Target unreachable (fake engine)");
      }

      return buildRunReport(options, "passed");
    },

    async plan(options: PlanEngineOptions): Promise<DeliveryPlan> {
      return {
        seed: options.seed,
        planHash: fakePlanHash(options.seed, options.scenario),
        provider: options.scenario.provider,
        flow: options.scenario.flow,
        deliveries: compileFakeDeliveries(options.scenario),
      };
    },

    listFlows(providerFilter?: string): readonly FlowListing[] {
      if (providerFilter === undefined) {
        return STATIC_FLOWS;
      }
      return STATIC_FLOWS.filter((f) => f.provider === providerFilter);
    },
  };
}

/**
 * INTEGRATION: swap to `import { runScenario, compilePlan, listFlows } from "@paymentchaos/core"`
 * when the engine surface lands.
 */
export function createEngine(): PaymentChaosEngine {
  return createFakeEngine();
}
