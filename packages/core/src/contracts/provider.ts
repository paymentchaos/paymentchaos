import type { Instant, SecretRef } from "./brand.ts";
import type { Headers, LogicalEvent, SignedDelivery, UnsignedDelivery } from "./events.ts";
import type { IdFactory, Rng } from "./runtime.ts";
import type { LogicalClock, TimestampFormat } from "./time.ts";

/**
 * A set of signing keys. Providers may sign a retried event with a previous secret
 * during rotation, so the set keeps the prior secrets too. Values are references, never
 * literal secrets (see ADR 0006).
 */
export interface SigningKeySet {
  readonly current: SecretRef;
  readonly previous?: readonly SecretRef[];
}

/**
 * How a provider delivers webhooks, as documented by the provider. Values come from
 * official documentation; a value the provider does not publish is `null`, never a
 * guessed number. This is metadata: the executor's local request timeout and any
 * simulated retries are PaymentChaos settings, not read from here (ADR 0009).
 */
export interface DeliveryProfile {
  /**
   * Per-attempt timeout the provider itself applies, in milliseconds, or `null` when
   * the provider does not publish one.
   */
  readonly timeoutMillis: number | null;
  /**
   * Exact intervals in milliseconds between the provider's automatic attempts. `null`
   * means the exact intervals are unpublished or unknown; `[]` means the provider
   * documents that it makes no automatic retries.
   */
  readonly retryScheduleMillis: readonly number[] | null;
  /** Allowed signature timestamp skew, in seconds, if the provider enforces one. */
  readonly signatureToleranceSec?: number;
  /** HTTP status codes the provider treats as successful acknowledgement. */
  readonly acceptedStatuses: readonly number[];
  /** How this provider encodes timestamps on the wire. */
  readonly timestampFormat: TimestampFormat;
}

/** A webhook request captured by the local listener, for verify/identify. */
export interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: Buffer;
  readonly receivedAt: Instant;
}

/** Result of verifying a captured request's signature. */
export interface VerifyResult {
  readonly valid: boolean;
  /** Which key verified it, when valid under rotation. */
  readonly keyUsed?: "current" | "previous";
  /** Human-readable reason when invalid. Never contains a secret. */
  readonly reason?: string;
}

/** A captured request recognized as a known provider event. */
export interface IdentifiedEvent {
  readonly provider: string;
  readonly type: string;
  readonly id?: string;
}

/** A lifecycle pack this provider offers. */
export interface FlowDescriptor {
  readonly id: string;
  readonly title: string;
  /** The ordered logical event types this flow emits, e.g. `["invoice.paid", …]`. */
  readonly events: readonly string[];
}

export type FlowCatalog = readonly FlowDescriptor[];

/** Inputs available while generating a flow's logical events. */
export interface GenerateContext {
  readonly rng: Rng;
  readonly ids: IdFactory;
  readonly clock: LogicalClock;
  /** ISO 4217 currency for amounts in this run. */
  readonly currency: string;
  /** ISO 3166-1 alpha-2 country, when the flow varies by region. */
  readonly country?: string;
  /** Provider API version whose payload shape to emit. */
  readonly apiVersion?: string;
}

/** Inputs available while encoding a logical event to wire bytes. */
export interface EncodeContext {
  readonly apiVersion?: string;
}

/**
 * The single integration point between the engine and a payment provider. The engine
 * treats {@link ProviderAdapter.sign} as opaque: it hands over bytes and key references
 * and receives bytes and headers back. This shape supports HMAC-over-body,
 * HMAC-over-timestamp-and-body, in-body HMAC, asymmetric/JWS and remote-verified
 * schemes without breaking changes. See ADR 0002.
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly apiVersions: readonly string[];
  readonly flows: FlowCatalog;
  readonly deliveryProfile: DeliveryProfile;
  readonly redactionRules: readonly RedactionRule[];

  /** Produce the ordered logical events for a flow. */
  generate(flow: string, ctx: GenerateContext): LogicalEvent[];
  /** Encode one logical event to the exact bytes that go on the wire. */
  encode(event: LogicalEvent, ctx: EncodeContext): Buffer;
  /** Sign a delivery, returning possibly-transformed bytes and signed headers. */
  sign(delivery: UnsignedDelivery, keys: SigningKeySet, at: Instant): SignedDelivery;
  /** Verify a captured request's signature (capture mode and the free verifier tools). */
  verify(request: CapturedRequest, keys: SigningKeySet): VerifyResult;
  /** Recognize a captured request as a provider event, or return null. */
  identify(request: CapturedRequest): IdentifiedEvent | null;
}

/**
 * A rule for redacting personal or sensitive data from a captured payload when turning
 * it into a reusable fixture. Matched by JSON path; the sanitize package applies it.
 */
export interface RedactionRule {
  /** JSONPath-like selector into the event object. */
  readonly path: string;
  /** How to replace the matched value. */
  readonly strategy: "remove" | "pseudonymize" | "constant";
  /** Replacement for the `constant` strategy. */
  readonly value?: string;
}
