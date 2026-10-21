import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signing: HMAC-SHA256 over `${timestamp}.${payload}`.
 * @see https://docs.stripe.com/webhooks/signatures
 */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSec = 300,
): { ok: true } | { ok: false; reason: string } {
  if (!signatureHeader) {
    return { ok: false, reason: "missing Stripe-Signature header" };
  }

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const v1Parts = parts.filter((part) => part.startsWith("v1="));
  if (!timestampPart || v1Parts.length === 0) {
    return { ok: false, reason: "malformed Stripe-Signature header" };
  }

  const timestamp = Number.parseInt(timestampPart.slice(2), 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "invalid signature timestamp" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    return { ok: false, reason: "signature timestamp outside tolerance" };
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  const match = v1Parts.some((part) => {
    const provided = part.slice(3);
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
  });

  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}
