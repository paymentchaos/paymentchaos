import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CapturedRequest,
  type Env,
  type Headers,
  type Instant,
  PaymentChaosError,
  resolveSecret,
  type SignedDelivery,
  type SigningKeySet,
  type UnsignedDelivery,
  type VerifyResult,
} from "@paymentchaos/core";
import { messages } from "./messages.ts";

export const SIGNATURE_TOLERANCE_SEC = 300;

// UTC milliseconds must fit JavaScript's interoperable Date/ISO time range.
// https://tc39.es/ecma262/#sec-time-values-and-time-range
const MAX_INSTANT_MILLIS = 8_640_000_000_000_000;
const isSupportedInstant = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= MAX_INSTANT_MILLIS;

// Stripe signs timestamp + '.' + unmodified body with SHA256; one v1 per active key.
// https://docs.stripe.com/webhooks/signature
// https://docs.stripe.com/webhooks#roll-endpoint-signing-secrets
function digest(body: Buffer, key: string, timestamp: number): string {
  return createHmac("sha256", key).update(`${timestamp}.`).update(body).digest("hex");
}

export function sign(
  delivery: UnsignedDelivery,
  keys: SigningKeySet,
  at: Instant,
  env: Env,
): SignedDelivery {
  if (!isSupportedInstant(at)) {
    throw new PaymentChaosError("SIGNING_FAILED", messages.timestamp);
  }
  const timestamp = Math.floor(at / 1000);
  const signatures = [keys.current, ...(keys.previous ?? [])].map(
    (ref) => `v1=${digest(delivery.body, resolveSecret(ref, env), timestamp)}`,
  );
  // Replace preexisting variants rather than emitting ambiguous duplicate headers.
  const headers: Headers = Object.fromEntries(
    Object.entries(delivery.headers).filter(([name]) => name.toLowerCase() !== "stripe-signature"),
  );
  headers["stripe-signature"] = `t=${timestamp},${signatures.join(",")}`;
  return { body: delivery.body, headers };
}

export function verify(request: CapturedRequest, keys: SigningKeySet, env: Env): VerifyResult {
  if (!isSupportedInstant(request.receivedAt)) {
    return { valid: false, reason: messages.receptionTimestamp };
  }
  const headers = Object.entries(request.headers).filter(
    ([name]) => name.toLowerCase() === "stripe-signature",
  );
  if (headers.length === 0) return { valid: false, reason: messages.missingHeader };
  if (headers.length !== 1) return { valid: false, reason: messages.malformedHeader };
  const header = headers[0]?.[1] ?? "";
  let timestamp = -1;
  const signatures: string[] = [];
  // Match SDK token handling (no trimming, last t wins, parseInt decimal semantics).
  // Reject unsupported UTC timestamps explicitly instead of inheriting its NaN bypass.
  // https://github.com/stripe/stripe-node/blob/v18.5.0/src/Webhooks.ts
  for (const token of header.split(",")) {
    const [name, value] = token.split("=");
    if (name === "t") timestamp = Number.parseInt(value ?? "", 10);
    if (name === "v1" && value !== undefined) signatures.push(value);
  }
  if (!isSupportedInstant(timestamp * 1000) || signatures.length === 0) {
    return { valid: false, reason: messages.malformedHeader };
  }
  let keyUsed: "current" | "previous" | undefined;
  for (const [index, ref] of [keys.current, ...(keys.previous ?? [])].entries()) {
    const expected = Buffer.from(digest(request.body, resolveSecret(ref, env), timestamp));
    const matches = signatures.some((signature) => {
      const candidate = Buffer.from(signature);
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    });
    if (matches && keyUsed === undefined) keyUsed = index === 0 ? "current" : "previous";
  }
  if (keyUsed === undefined) return { valid: false, reason: messages.mismatch };
  // SDK v18.5.0 floors receivedAt (milliseconds) and checks AGE, not absolute skew:
  // future signatures pass; age exactly 300 seconds passes. Source above.
  if (Math.floor(request.receivedAt / 1000) - timestamp > SIGNATURE_TOLERANCE_SEC) {
    return { valid: false, reason: messages.stale };
  }
  return { valid: true, keyUsed };
}
