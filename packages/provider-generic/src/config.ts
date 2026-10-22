import { PaymentChaosError } from "@paymentchaos/core";
import * as z from "zod";
import { messages } from "./messages.ts";

const reserved = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "webhook-id",
  "webhook-timestamp",
  "x-webhook-id",
  "x-webhook-timestamp",
  "x-paymentchaos-mode",
]);
const custom = z.strictObject({
  header: z
    .string()
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
    .refine((v) => !reserved.has(v.toLowerCase()), messages.header),
  algorithm: z.enum(["sha256", "sha1", "sha512"]),
  encoding: z.enum(["hex", "base64"]),
  prefix: z
    .string()
    .regex(/^[\x20-\x7e]*$/)
    .default(""),
  template: z
    .string()
    .refine(
      (v) => v.includes("{body}") && !/[{}]/.test(v.replace(/\{(?:body|id|timestamp)\}/g, "")),
      messages.template,
    ),
});
const schema = z.strictObject({
  currency: z.string().length(3).optional(),
  country: z.string().length(2).optional(),
  format: z.union([z.enum(["raw-body-hex", "standard-webhooks"]), custom]).default("raw-body-hex"),
  events: z.array(z.strictObject({ type: z.string().min(1), body: z.string().min(1) })).min(1),
});

export function parseParams(params: unknown) {
  const result = schema.safeParse(params);
  if (!result.success) {
    // Never include input values: a malformed config might contain a pasted secret.
    const issues = result.error.issues
      .map((i) => `${["params", ...i.path].join(".")}: ${i.code}`)
      .join("; ");
    throw new PaymentChaosError("CONFIG_INVALID", messages.config(issues));
  }
  return result.data;
}
