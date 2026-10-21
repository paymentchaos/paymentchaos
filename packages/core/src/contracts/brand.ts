/**
 * Nominal (branded) types. A branded string is still a string at runtime, but the
 * compiler refuses to mix, say, an {@link EventId} with a raw string. This keeps
 * provider-shaped identifiers and secret references from being confused with
 * arbitrary text in the engine.
 */

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A provider-shaped event identifier, e.g. `evt_1A2b3C`. */
export type EventId = Brand<string, "EventId">;

/** A reference to a secret, written as `${ENV_VAR}` and resolved only at send time. */
export type SecretRef = Brand<string, "SecretRef">;

/** A UTC instant in epoch milliseconds. Never a local-timezone value. */
export type Instant = Brand<number, "Instant">;

export const asEventId = (value: string): EventId => value as EventId;
export const asSecretRef = (value: string): SecretRef => value as SecretRef;
export const asInstant = (epochMillis: number): Instant => epochMillis as Instant;

/** Pattern a {@link SecretRef} string must match: `${ENV_VAR}`. */
export const SECRET_REF_PATTERN = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/** Extract the environment variable name from a `${ENV_VAR}` reference. */
export const secretEnvName = (ref: SecretRef): string => ref.slice(2, -1);
