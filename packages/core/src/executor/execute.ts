import { setTimeout as sleep } from "node:timers/promises";
import { Agent, type Dispatcher, request } from "undici";
import {
  asInstant,
  type Delivery,
  type DeliveryResult,
  type Headers,
  type Instant,
  PaymentChaosError,
  type ProviderAdapter,
  type SignedDelivery,
  type SigningKeySet,
  toIso8601,
} from "../contracts/index.ts";
import { messages } from "../messages.ts";
import type { CompiledPlan } from "../plan/compile.ts";
import { type Env, redactSecrets, resolveSecret, secretValues } from "../safety/secrets.ts";
import { assertTargetAllowed } from "../safety/target-guard.ts";

/**
 * The executor: the nondeterministic half of a run (ADR 0003). Dispatch order is the
 * plan's; the target's interleaving of a concurrency group is not ours to control.
 * Wall-clock reads are allowed here, unlike in planning.
 */

export interface ExecuteOptions {
  readonly url: string;
  readonly keys: SigningKeySet;
  readonly allowRemoteTarget?: string | readonly string[];
  /** Wall time per logical millisecond: 0.001 turns a 3-day schedule into ~4.3 minutes. */
  readonly timeScale?: number;
  /**
   * PaymentChaos's local per-request timeout, in whole milliseconds. Defaults to
   * {@link DEFAULT_REQUEST_TIMEOUT_MS}. The adapter's `deliveryProfile.timeoutMillis` is
   * provider metadata and never sets this budget (ADR 0009).
   */
  readonly timeoutMillis?: number;
  readonly signal?: AbortSignal;
  /** Where secret references resolve, for the fail-fast check and redaction. */
  readonly env?: Env;
  /** Signature time source. Defaults to the wall clock. */
  readonly now?: () => number;
  readonly dispatcher?: Dispatcher;
  /** Called as each delivery completes, for a live timeline. */
  readonly onDelivery?: (outcome: DeliveryOutcome) => void;
}

export interface DeliveryOutcome extends DeliveryResult {
  readonly concurrencyGroup?: string;
  /** Status was in the adapter's `acceptedStatuses` and no error occurred. */
  readonly accepted: boolean;
  /** UTC ISO 8601 time the request was released. */
  readonly sentAt: string;
}

export interface ExecutionResult {
  readonly startedAt: string;
  readonly finishedAt: string;
  /** In plan order (`seq`), regardless of completion order. */
  readonly deliveries: readonly DeliveryOutcome[];
}

/**
 * PaymentChaos's default local per-request timeout. A simulation setting, not any
 * provider's published timeout (ADR 0009).
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** `AbortSignal.timeout()` clamps larger delays to 1 ms, so they are rejected up front. */
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

/** Resolve and validate the local request timeout. Pure, so callers run it before any side effect. */
export function resolveRequestTimeout(timeoutMillis: number | undefined): number {
  const value = timeoutMillis ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_REQUEST_TIMEOUT_MS) {
    throw new PaymentChaosError(
      "CONFIG_INVALID",
      messages.requestTimeoutInvalid(value, MAX_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    );
  }
  return value;
}

const BASE_HEADERS: Headers = { "content-type": "application/json", "user-agent": "PaymentChaos" };

/** Connection-level failures that mean "nothing is listening there". */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const errorCode = (error: unknown): string | undefined => {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
};

/** Consecutive members of one concurrency group form one step; others are alone. */
function steps(deliveries: readonly Delivery[]): Delivery[][] {
  const out: Delivery[][] = [];
  for (const d of deliveries) {
    const last = out.at(-1);
    const group = d.concurrencyGroup;
    if (group !== undefined && last?.[0]?.concurrencyGroup === group) last.push(d);
    else out.push([d]);
  }
  return out;
}

/** Send a compiled plan to the target and record what happened to every delivery. */
export async function executePlan(
  compiled: CompiledPlan,
  adapter: ProviderAdapter,
  options: ExecuteOptions,
): Promise<ExecutionResult> {
  // Safety first: nothing below may run for a blocked target (ADR 0006).
  const url = assertTargetAllowed(
    options.url,
    options.allowRemoteTarget === undefined ? {} : { allowRemoteTarget: options.allowRemoteTarget },
  );
  const timeoutMillis = resolveRequestTimeout(options.timeoutMillis);
  const timeScale = options.timeScale ?? 1;
  if (!Number.isFinite(timeScale) || timeScale < 0) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.timeScaleInvalid(timeScale));
  }
  const env = options.env ?? process.env;
  resolveSecret(options.keys.current, env);
  const secrets = secretValues(options.keys, env);
  const accepted = new Set(adapter.deliveryProfile.acceptedStatuses);
  const now = options.now ?? Date.now;
  const dispatcher = options.dispatcher ?? new Agent();

  const sign = (d: Delivery, at: Instant): SignedDelivery => {
    const body = compiled.bodies.get(d.event.id);
    if (body === undefined)
      throw new PaymentChaosError("INTERNAL", messages.bodyMissing(d.event.id));
    try {
      return adapter.sign(
        { body, headers: { ...BASE_HEADERS }, event: { id: d.event.id, type: d.event.type } },
        options.keys,
        at,
      );
    } catch (cause) {
      if (cause instanceof PaymentChaosError) throw cause;
      const reason = redactSecrets(cause instanceof Error ? cause.message : String(cause), secrets);
      throw new PaymentChaosError(
        "SIGNING_FAILED",
        messages.signingFailed(adapter.id, d.event.type, reason),
      );
    }
  };

  let reachedTarget = false;
  const send = async (d: Delivery, signed: SignedDelivery): Promise<DeliveryOutcome> => {
    const base = {
      seq: d.seq,
      attempt: d.attempt,
      eventType: d.event.type,
      eventId: d.event.id,
      chaosTags: [...d.chaosTags],
      ...(d.concurrencyGroup === undefined ? {} : { concurrencyGroup: d.concurrencyGroup }),
      sentAt: toIso8601(asInstant(now())),
    };
    const timeout = AbortSignal.timeout(timeoutMillis);
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
    const started = performance.now();
    try {
      const response = await request(url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        signal,
        dispatcher,
      });
      reachedTarget = true;
      await response.body.dump();
      const latencyMs = performance.now() - started;
      return {
        ...base,
        statusCode: response.statusCode,
        latencyMs,
        accepted: accepted.has(response.statusCode),
      };
    } catch (error) {
      const latencyMs = performance.now() - started;
      if (options.signal?.aborted) throw options.signal.reason;
      const code = errorCode(error);
      if (!reachedTarget && code !== undefined && UNREACHABLE_CODES.has(code)) {
        throw new PaymentChaosError(
          "TARGET_UNREACHABLE",
          messages.targetUnreachable(url.host, code),
          { cause: error, details: { host: url.host, code } },
        );
      }
      const text = timeout.aborted
        ? messages.deliveryTimedOut(timeoutMillis)
        : messages.deliveryFailed(code ?? (error instanceof Error ? error.message : String(error)));
      return { ...base, latencyMs, error: redactSecrets(text, secrets), accepted: false };
    }
  };

  const startedAt = toIso8601(asInstant(now()));
  const signalOption = options.signal === undefined ? {} : { signal: options.signal };
  const origin = performance.now();
  const outcomes: DeliveryOutcome[] = [];
  try {
    for (const step of steps(compiled.plan.deliveries)) {
      const first = step[0] as Delivery;
      const wait = origin + first.sendOffsetMillis * timeScale - performance.now();
      if (wait > 0) {
        await sleep(wait, undefined, signalOption).catch((error: unknown) => {
          throw options.signal?.reason ?? error;
        });
      }
      options.signal?.throwIfAborted();
      // Barrier: sign every member first, then release all requests in the same tick.
      const signed = step.map((d) => sign(d, asInstant(now())));
      const results = await Promise.all(
        step.map((d, i) =>
          send(d, signed[i] as SignedDelivery).then((o) => {
            options.onDelivery?.(o);
            return o;
          }),
        ),
      );
      outcomes.push(...results);
    }
  } finally {
    if (options.dispatcher === undefined) await (dispatcher as Agent).close();
  }
  return { startedAt, finishedAt: toIso8601(asInstant(now())), deliveries: outcomes };
}
