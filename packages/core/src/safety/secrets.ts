import {
  PaymentChaosError,
  SECRET_REF_PATTERN,
  type SecretRef,
  type SigningKeySet,
  secretEnvName,
} from "../contracts/index.ts";
import { messages } from "../messages.ts";

/**
 * Secret handling (ADR 0006). Planning and reporting only ever hold {@link SecretRef}s;
 * values are resolved at send time, by the provider adapter's `sign`, and scrubbed from
 * any error text before it can reach a report.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export const REDACTED = "[REDACTED]";

/** Resolve a `${ENV_VAR}` reference. Throws SECRET_MISSING naming the variable, never a value. */
export function resolveSecret(ref: SecretRef, env: Env = process.env): string {
  if (!SECRET_REF_PATTERN.test(ref)) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.secretRefInvalid());
  }
  const name = secretEnvName(ref);
  const value = env[name];
  if (value === undefined || value === "") {
    throw new PaymentChaosError("SECRET_MISSING", messages.secretMissing(name), {
      details: { envVar: name },
    });
  }
  return value;
}

/** Every resolvable value in a key set, for redaction. Missing variables are skipped. */
export function secretValues(keys: SigningKeySet, env: Env = process.env): string[] {
  const values: string[] = [];
  for (const ref of [keys.current, ...(keys.previous ?? [])]) {
    const value = SECRET_REF_PATTERN.test(ref) ? env[secretEnvName(ref)] : undefined;
    if (value !== undefined && value !== "") values.push(value);
  }
  return values;
}

/** Replace every occurrence of any secret in `text`, longest first. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of [...secrets].filter((s) => s !== "").sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(REDACTED);
  }
  return out;
}
