import {
  type DeliveryPlan,
  type EventId,
  type Instant,
  PaymentChaosError,
  type ProviderAdapter,
  type Scenario,
} from "../contracts/index.ts";
import { messages } from "../messages.ts";
import {
  applyChaos,
  defaultOperatorRegistry,
  type OperatorRegistry,
} from "../operators/registry.ts";
import { createLogicalClock, LOGICAL_EPOCH } from "../runtime/clock.ts";
import { createIdFactory } from "../runtime/ids.ts";
import { createRng } from "../runtime/rng.ts";
import { createDraft } from "./draft.ts";
import { hashPlan } from "./hash.ts";

/** Used when a scenario sets no `params.currency`. */
export const DEFAULT_CURRENCY = "USD";

export interface CompileOptions {
  readonly seed: number;
  /** Per-run nonce for ids; omit for stable ids. Never changes the plan hash. */
  readonly nonce?: string;
  /** Start of logical time. Defaults to {@link LOGICAL_EPOCH}. */
  readonly startAt?: Instant;
  readonly operators?: OperatorRegistry;
}

export interface CompiledPlan {
  readonly plan: DeliveryPlan;
  readonly apiVersion: string | undefined;
  /** Exact wire bytes per logical event. Every redelivery reuses these bytes. */
  readonly bodies: ReadonlyMap<EventId, Buffer>;
  /** Named ids issued while generating (`customer`, `subscription`, …). */
  readonly ids: Readonly<Record<string, string>>;
}

function configError(message: string, details: Record<string, unknown>): PaymentChaosError {
  return new PaymentChaosError("CONFIG_INVALID", message, { details });
}

/**
 * Compile a validated scenario into a deterministic delivery plan. Pure apart from the
 * adapter: no wall clock, no platform RNG. Same seed + scenario + engine version give
 * the same `planHash`, with or without a nonce.
 */
export function compilePlan(
  scenario: Scenario,
  adapter: ProviderAdapter,
  options: CompileOptions,
): CompiledPlan {
  if (scenario.provider !== adapter.id) {
    throw configError(messages.providerMismatch(scenario.provider, adapter.id), {
      provider: scenario.provider,
    });
  }
  if (!adapter.flows.some((f) => f.id === scenario.flow)) {
    const flows = adapter.flows.map((f) => f.id);
    throw configError(messages.flowUnknown(scenario.flow, adapter.id, flows), {
      flow: scenario.flow,
    });
  }
  const apiVersion = scenario.apiVersion ?? adapter.apiVersions[0];
  if (scenario.apiVersion !== undefined && !adapter.apiVersions.includes(scenario.apiVersion)) {
    throw configError(
      messages.apiVersionUnsupported(scenario.apiVersion, adapter.id, adapter.apiVersions),
      { apiVersion: scenario.apiVersion },
    );
  }

  const root = createRng(options.seed);
  const ids = createIdFactory(
    root.fork("ids"),
    options.nonce === undefined ? {} : { nonce: options.nonce },
  );
  const country = scenario.params?.country;
  const events = adapter.generate(scenario.flow, {
    rng: root.fork("generate"),
    ids,
    clock: createLogicalClock(options.startAt ?? LOGICAL_EPOCH),
    currency: (scenario.params?.currency ?? DEFAULT_CURRENCY).toUpperCase(),
    ...(country === undefined ? {} : { country: country.toUpperCase() }),
    ...(apiVersion === undefined ? {} : { apiVersion }),
  });

  const encodeContext = apiVersion === undefined ? {} : { apiVersion };
  const bodies = new Map<EventId, Buffer>();
  for (const event of events) {
    if (bodies.has(event.id)) {
      throw new PaymentChaosError("INTERNAL", messages.eventIdDuplicated(adapter.id, event.id));
    }
    const body = adapter.encode(event, encodeContext);
    if (!body.equals(adapter.encode(event, encodeContext))) {
      throw new PaymentChaosError("INTERNAL", messages.encodeNotByteStable(adapter.id, event.type));
    }
    bodies.set(event.id, body);
  }

  const draft = applyChaos(
    createDraft(options.seed, adapter.id, scenario.flow, events),
    scenario.chaos,
    root.fork("chaos"),
    options.operators ?? defaultOperatorRegistry,
  );
  const planHash = hashPlan({ draft, apiVersion, bodies, nonce: options.nonce });
  return { plan: { ...draft, planHash }, apiVersion, bodies, ids: ids.named() };
}
