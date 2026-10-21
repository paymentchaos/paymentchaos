import { PaymentChaosError } from "@paymentchaos/core";
import { messages } from "./messages.ts";

const POSITIVE_INT = /^(?:0|[1-9]\d*)$/;

function flagString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

/** Parse an optional positive integer CLI flag; rejects partial numeric garbage. */
export function parseOptionalPositiveInt(value: unknown, flagName: string): number | undefined {
  const raw = flagString(value);
  if (raw === undefined) {
    return undefined;
  }
  if (!POSITIVE_INT.test(raw)) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.flagNotPositiveInt(flagName, raw));
  }
  const parsed = Number(raw);
  if (parsed < 1) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.flagNotPositiveInt(flagName, raw));
  }
  return parsed;
}

/** Parse seed: any non-negative integer within the PRNG range. */
export function parseOptionalSeed(value: unknown): number | undefined {
  const raw = flagString(value);
  if (raw === undefined) {
    return undefined;
  }
  if (!POSITIVE_INT.test(raw) && raw !== "0") {
    throw new PaymentChaosError("CONFIG_INVALID", messages.flagInvalidSeed(raw));
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed >= 2 ** 31) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.flagInvalidSeed(raw));
  }
  return parsed;
}
