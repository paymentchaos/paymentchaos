import { createHash } from "node:crypto";
import type { EventId } from "../contracts/index.ts";
import { PRNG_VERSION } from "../runtime/rng.ts";
import type { PlanDraft } from "./draft.ts";

/**
 * Version of the normalized-plan layout below. Bump it (a breaking change) whenever the
 * hashed fields change meaning, so old and new hashes can never be confused.
 */
export const PLAN_FORMAT_VERSION = 1;

export interface PlanHashInput {
  readonly draft: PlanDraft;
  readonly apiVersion: string | undefined;
  /** Exact wire bytes per logical event, from `adapter.encode`. */
  readonly bodies: ReadonlyMap<EventId, Buffer>;
  /** The run nonce, removed before hashing so runs that differ only by nonce match. */
  readonly nonce: string | undefined;
}

function removeAll(bytes: Buffer, needle: Buffer): Buffer {
  if (needle.length === 0) return bytes;
  const parts: Buffer[] = [];
  let from = 0;
  for (let at = bytes.indexOf(needle, from); at !== -1; at = bytes.indexOf(needle, from)) {
    parts.push(bytes.subarray(from, at));
    from = at + needle.length;
  }
  parts.push(bytes.subarray(from));
  return Buffer.concat(parts);
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/**
 * The stable plan hash (ADR 0003): SHA-256 over a normalized description of what will
 * be sent: every delivery's position, attempt, event, group, offset, tags and a digest
 * of the exact body bytes. Where it is sent (target, secrets) and how it is judged
 * (assertions, repeat) are deliberately excluded, so one plan can be compared across
 * environments. The body is only hashed, never parsed.
 */
export function hashPlan({ draft, apiVersion, bodies, nonce }: PlanHashInput): string {
  const strip = nonce === undefined || nonce === "" ? undefined : nonce;
  const stripText = (text: string) => (strip === undefined ? text : text.split(strip).join(""));
  const stripBytes = (body: Buffer) =>
    strip === undefined ? body : removeAll(body, Buffer.from(strip, "utf8"));

  const normalized = {
    format: PLAN_FORMAT_VERSION,
    prng: PRNG_VERSION,
    seed: draft.seed,
    provider: draft.provider,
    flow: draft.flow,
    apiVersion: apiVersion ?? null,
    deliveries: draft.deliveries.map((d) => {
      const body = bodies.get(d.event.id);
      return {
        seq: d.seq,
        attempt: d.attempt,
        eventId: stripText(d.event.id),
        eventType: d.event.type,
        occurredAt: d.event.occurredAt,
        group: d.concurrencyGroup ?? null,
        offsetMillis: d.sendOffsetMillis,
        tags: d.chaosTags,
        body: body === undefined ? null : sha256(stripBytes(body)),
      };
    }),
  };
  // Keys are constructed in a fixed order, so JSON.stringify is canonical here.
  return sha256(JSON.stringify(normalized));
}
