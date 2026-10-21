import { randomInt } from "node:crypto";
import type { IdFactory, Rng } from "../contracts/index.ts";
import { messages } from "../messages.ts";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RANDOM_LENGTH = 16;
export const RUN_NONCE_LENGTH = 8;

const PREFIX_PATTERN = /^[a-z][a-z0-9]*$/;
const NONCE_PATTERN = new RegExp(`^[0-9A-Za-z]{${RUN_NONCE_LENGTH}}$`);

/**
 * Human names for well-known prefixes. They become `PAYMENTCHAOS_ID_<NAME>` and the
 * keys of `PAYMENTCHAOS_IDS_JSON` for assertion commands (ADR 0005). Unknown prefixes
 * use the prefix itself as the name.
 */
const NAME_BY_PREFIX: Readonly<Record<string, string>> = {
  evt: "event",
  cus: "customer",
  sub: "subscription",
  in: "invoice",
  pi: "payment_intent",
  ch: "charge",
  cs: "checkout_session",
  pay: "payment",
  order: "order",
  plan: "plan",
};

export interface IssuedId {
  readonly prefix: string;
  /** `customer`, then `customer_2`, … in issue order. */
  readonly name: string;
  readonly value: string;
}

export interface IdFactoryOptions {
  /**
   * Per-run nonce mixed into every id so repeated runs against a persistent database
   * don't collide. Omit it for stable ids (`--stable-ids`).
   */
  readonly nonce?: string;
}

/** An {@link IdFactory} that also remembers what it issued, for assertion commands. */
export interface RecordingIdFactory extends IdFactory {
  issued(): readonly IssuedId[];
  /** `{ customer: "cus_…", subscription: "sub_…", … }` in issue order. */
  named(): Record<string, string>;
}

class SeededIdFactory implements RecordingIdFactory {
  readonly #rng: Rng;
  readonly #nonce: string;
  readonly #issued: IssuedId[] = [];
  readonly #seen = new Set<string>();
  readonly #countByName = new Map<string, number>();

  constructor(rng: Rng, nonce: string) {
    this.#rng = rng;
    this.#nonce = nonce;
  }

  make(prefix: string): string {
    if (!PREFIX_PATTERN.test(prefix)) throw new RangeError(messages.idPrefixInvalid(prefix));
    let value: string;
    do {
      let random = "";
      for (let i = 0; i < RANDOM_LENGTH; i++) random += ALPHABET[this.#rng.int(ALPHABET.length)];
      value = `${prefix}_${this.#nonce}${random}`;
    } while (this.#seen.has(value));
    this.#seen.add(value);

    const base = NAME_BY_PREFIX[prefix] ?? prefix;
    const count = (this.#countByName.get(base) ?? 0) + 1;
    this.#countByName.set(base, count);
    this.#issued.push({ prefix, name: count === 1 ? base : `${base}_${count}`, value });
    return value;
  }

  issued(): readonly IssuedId[] {
    return this.#issued;
  }

  named(): Record<string, string> {
    return Object.fromEntries(this.#issued.map((id) => [id.name, id.value]));
  }
}

/** Create the id factory for one plan compilation. Draws only from `rng`. */
export function createIdFactory(rng: Rng, options: IdFactoryOptions = {}): RecordingIdFactory {
  const nonce = options.nonce ?? "";
  if (nonce !== "" && !NONCE_PATTERN.test(nonce)) {
    throw new RangeError(messages.runNonceInvalid(RUN_NONCE_LENGTH));
  }
  return new SeededIdFactory(rng, nonce);
}

/**
 * A fresh random run nonce. This deliberately uses the platform CSPRNG: it is run
 * setup, not planning, and must differ between runs.
 */
export function createRunNonce(): string {
  let nonce = "";
  for (let i = 0; i < RUN_NONCE_LENGTH; i++) nonce += ALPHABET[randomInt(ALPHABET.length)];
  return nonce;
}
