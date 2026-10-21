import { signStripeBody } from "./stripe-sign.js";

export interface DeliveryResult {
  readonly eventType: string;
  readonly eventId: string;
  readonly statusCode: number;
}

export async function postStripeWebhook(
  targetUrl: string,
  secret: string,
  body: Buffer,
  meta: { eventType: string; eventId: string },
): Promise<DeliveryResult> {
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signStripeBody(body, secret),
    },
    body,
  });

  return {
    eventType: meta.eventType,
    eventId: meta.eventId,
    statusCode: response.status,
  };
}
