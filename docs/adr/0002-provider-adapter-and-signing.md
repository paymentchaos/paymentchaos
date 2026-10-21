# ADR 0002: Provider adapter and signing model

Status: Accepted · 2026-10-21

## Context

The original notes modelled signing as `sign(rawBody, secret): SignedHeaders`. That fits Stripe and Razorpay but not providers PaymentChaos will need for a global product: Paddle and Standard Webhooks sign over `timestamp + body`; Adyen puts an HMAC of selected fields *inside* the body; Apple App Store Server Notifications v2 use signed JWS with a certificate chain; PayPal and Google Play RTDN can only be verified by a remote call. If the interface only returns headers for a raw-body HMAC, adding those providers later breaks it.

The contract must support all five signing shapes now, even though M1 implements only HMAC-over-body (Razorpay, generic) and HMAC-over-timestamp-and-body (Stripe).

## Decision

A signer produces a complete `SignedDelivery` — header mutations **and** an optional body transform — rather than just headers. Keys are a set that supports rotation.

```ts
interface SigningKeySet {
  current: SecretRef;        // never the literal secret; resolved at send time
  previous?: SecretRef[];    // rotation: provider may sign retries with an old secret
}

interface UnsignedDelivery {
  readonly body: Buffer;              // exact bytes; never re-serialized after this point
  readonly headers: Headers;
  readonly event: LogicalEventRef;
}

interface SignedDelivery {
  readonly body: Buffer;              // may differ from input (in-body signatures)
  readonly headers: Headers;
}

interface ProviderAdapter {
  readonly id: string;                         // "stripe"
  readonly displayName: string;
  readonly apiVersions: readonly string[];
  readonly flows: FlowCatalog;
  readonly deliveryProfile: DeliveryProfile;   // timeoutMs, retrySchedule, signatureToleranceSec, acceptedStatuses
  readonly redactionRules: readonly RedactionRule[];

  generate(flow: FlowId, ctx: GenerateContext): LogicalEvent[];
  encode(event: LogicalEvent, ctx: EncodeContext): Buffer;      // exact wire bytes
  sign(delivery: UnsignedDelivery, keys: SigningKeySet, at: Instant): SignedDelivery;
  verify(request: CapturedRequest, keys: SigningKeySet): VerifyResult;
  identify(request: CapturedRequest): IdentifiedEvent | null;
}
```

Signing schemes the model must cover without future breaking changes: HMAC over body; HMAC over timestamp+body; HMAC over selected in-body fields; asymmetric/JWS; remote-verified (documented mock mode). The engine treats `sign` as opaque: it hands over bytes and keys and gets back bytes and headers.

Secrets are passed as a `SecretRef` (an environment variable name or a reference resolved at send time), never as a literal, so the planning and reporting layers can never serialize a secret (see ADR 0006).

## Consequences

- M1 implements Stripe (`t=,v1=` with rotation and tolerance) and raw-body HMAC (Razorpay, generic). The interface already allows Adyen/Apple/PayPal later.
- Every signer ships an oracle test: sign with PaymentChaos, verify with the provider's official SDK; a corrupted signature must fail that same verification.
- `encode` returns a `Buffer` and is the last point allowed to produce bytes; operators and the executor treat the body as opaque bytes thereafter.
- `verify` powers both capture mode and the free signature-verifier web tools.
