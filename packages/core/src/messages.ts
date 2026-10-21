/**
 * Every user-facing string in `@paymentchaos/core`. Keeping them in one module keeps
 * translation possible later (AGENTS.md rule 9). Messages say what happened, where,
 * and how to fix it, and never interpolate a secret value.
 */
export const messages = {
  rngSeedInvalid: (seed: number) =>
    `Seed ${String(seed)} is not a safe integer. Use a whole number such as --seed 1337.`,
  rngIntRangeInvalid: (max: number) =>
    `Rng.int() needs an integer bound between 1 and 2^32, got ${String(max)}.`,
  rngPickEmpty: () => "Rng.pick() needs a non-empty array.",
  idPrefixInvalid: (prefix: string) =>
    `Id prefix "${prefix}" is invalid. Use lowercase letters and digits, such as "evt" or "cus".`,
  runNonceInvalid: (length: number) =>
    `Run nonce must be exactly ${String(length)} ASCII letters or digits.`,
  clockAdvanceInvalid: (millis: number) =>
    `LogicalClock.advance() needs a finite, non-negative number of milliseconds, got ${String(millis)}.`,
  clockStartInvalid: (start: number) =>
    `Logical clock start must be an integer epoch-millisecond instant, got ${String(start)}.`,
} as const;
