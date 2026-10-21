/**
 * Money is always an integer number of an ISO 4217 currency's minor units plus the
 * currency code. Never a float. See ADR 0007.
 *
 * The exponent table below is owned by the provider stream (see AGENTS.md) and is
 * part of the frozen contract surface. Provider-specific amount quirks live in the
 * provider adapter, never here.
 */

export interface Money {
  /** Integer amount in the currency's minor units (e.g. cents). May be negative (refunds). */
  readonly amount: number;
  /** Uppercase ISO 4217 alphabetic code, e.g. `USD`, `JPY`, `BHD`. */
  readonly currency: string;
}

/** ISO 4217 currencies with zero minor-unit digits. */
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

/** ISO 4217 currencies with three minor-unit digits. */
export const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

/** Minor-unit exponent for a currency. Defaults to 2 for anything not listed. */
export function minorUnitExponent(currency: string): 0 | 2 | 3 {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/** Number of minor units in one major unit, e.g. 100 for USD, 1 for JPY, 1000 for BHD. */
export function minorUnitsPerMajor(currency: string): number {
  return 10 ** minorUnitExponent(currency);
}
