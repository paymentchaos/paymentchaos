import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CapturedRequest,
  type Env,
  type Instant,
  PaymentChaosError,
  resolveSecret,
  type SigningKeySet,
  type UnsignedDelivery,
  type VerifyResult,
} from "@paymentchaos/core";
import type { parseParams } from "./config.ts";
import { messages } from "./messages.ts";

type Format = ReturnType<typeof parseParams>["format"];
const raw = {
  header: "x-webhook-signature",
  algorithm: "sha256",
  encoding: "hex",
  prefix: "",
  template: "{body}",
} as const;
const standard = {
  header: "webhook-signature",
  algorithm: "sha256",
  encoding: "base64",
  prefix: "v1,",
  template: "{id}.{timestamp}.{body}",
} as const;
export const validInstant = (n: number) =>
  Number.isSafeInteger(n) && n >= 0 && n <= 8_640_000_000_000_000;
const config = (format: Format) =>
  typeof format === "string" ? (format === "standard-webhooks" ? standard : raw) : format;

function content(template: string, body: Buffer, id: string, timestamp: string): Buffer {
  // Substitute tokens as byte chunks: body bytes are never decoded/re-encoded.
  return Buffer.concat(
    template
      .split(/(\{body\}|\{id\}|\{timestamp\})/)
      .map((part) =>
        part === "{body}"
          ? body
          : Buffer.from(part === "{id}" ? id : part === "{timestamp}" ? timestamp : part, "utf8"),
      ),
  );
}
function key(secret: string, isStandard: boolean): string | Buffer {
  if (!isStandard) return secret;
  // https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#signature-scheme
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : "";
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length < 24 || decoded.length > 64 || decoded.toString("base64") !== encoded)
    throw new PaymentChaosError("SIGNING_FAILED", messages.secret);
  return decoded;
}
const read = (headers: Record<string, string>, name: string): string | undefined => {
  const matches = Object.entries(headers).filter(([k]) => k.toLowerCase() === name);
  return matches.length === 1 ? matches[0]?.[1] : undefined;
};
const equal = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function sign(
  delivery: UnsignedDelivery,
  keys: SigningKeySet,
  at: Instant,
  env: Env,
  format: Format,
) {
  if (!validInstant(at)) throw new PaymentChaosError("SIGNING_FAILED", messages.timestamp);
  const cfg = config(format);
  const isStandard = format === "standard-webhooks";
  const id = delivery.event.id;
  const timestamp = String(Math.floor(at / 1000));
  const signed = content(cfg.template, delivery.body, id, timestamp);
  // Standard Webhooks rotates using space-delimited signatures. Custom formats
  // have no defined multi-signature grammar and sign only with the current key.
  // https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#webhook-headers-sending-metadata-to-consumers
  const refs = isStandard ? [keys.current, ...(keys.previous ?? [])] : [keys.current];
  const signature = refs
    .map(
      (ref) =>
        cfg.prefix +
        createHmac(cfg.algorithm, key(resolveSecret(ref, env), isStandard))
          .update(signed)
          .digest(cfg.encoding),
    )
    .join(" ");
  const idHeader = isStandard ? "webhook-id" : "x-webhook-id";
  const timeHeader = isStandard ? "webhook-timestamp" : "x-webhook-timestamp";
  const headers = Object.fromEntries(
    Object.entries(delivery.headers).filter(
      ([k]) =>
        ![cfg.header.toLowerCase(), idHeader, timeHeader, "x-paymentchaos-mode"].includes(
          k.toLowerCase(),
        ),
    ),
  );
  return {
    body: delivery.body,
    headers: {
      ...headers,
      [idHeader]: id,
      [timeHeader]: timestamp,
      [cfg.header.toLowerCase()]: signature,
      "x-paymentchaos-mode": "test",
    },
  };
}

export function verify(
  request: CapturedRequest,
  keys: SigningKeySet,
  env: Env,
  format: Format,
): VerifyResult {
  const cfg = config(format);
  const isStandard = format === "standard-webhooks";
  const signature = read(request.headers, cfg.header.toLowerCase());
  const id = read(request.headers, isStandard ? "webhook-id" : "x-webhook-id");
  const timestamp = read(request.headers, isStandard ? "webhook-timestamp" : "x-webhook-timestamp");
  if (
    !signature ||
    (cfg.template.includes("{id}") && !id) ||
    (cfg.template.includes("{timestamp}") &&
      (!timestamp || !/^\d+$/.test(timestamp) || !validInstant(Number(timestamp) * 1000)))
  )
    return { valid: false, reason: messages.mismatch };
  const signed = content(cfg.template, request.body, id ?? "", timestamp ?? "");
  for (const [i, ref] of [keys.current, ...(keys.previous ?? [])].entries()) {
    const expected =
      cfg.prefix +
      createHmac(cfg.algorithm, key(resolveSecret(ref, env), isStandard))
        .update(signed)
        .digest(cfg.encoding);
    if ((isStandard ? signature.split(" ") : [signature]).some((s) => equal(s, expected))) {
      // 300s is our local policy, matching official JS SDK 1.0.0's default.
      // https://github.com/standard-webhooks/standard-webhooks/tree/main/libraries/javascript
      if (
        isStandard &&
        (!validInstant(request.receivedAt) ||
          Math.abs(Math.floor(request.receivedAt / 1000) - Number(timestamp)) > 300)
      )
        return { valid: false, reason: messages.stale };
      return { valid: true, keyUsed: i === 0 ? "current" : "previous" };
    }
  }
  return { valid: false, reason: messages.mismatch };
}
