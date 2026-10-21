import { createHmac } from "node:crypto";

export function signStripeBody(body: Buffer, secret: string, timestampSec?: number): string {
  const timestamp = timestampSec ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${body.toString("utf8")}`;
  const digest = createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return `t=${timestamp},v1=${digest}`;
}
