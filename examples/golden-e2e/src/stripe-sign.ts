import { createHmac } from "node:crypto";

/** Matches `@paymentchaos/provider-stripe` digest: `${timestamp}.` + raw body bytes. */
export function signStripeBody(body: Buffer, secret: string, timestampSec?: number): string {
  const timestamp = timestampSec ?? Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}
