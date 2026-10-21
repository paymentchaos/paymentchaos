/** Format unknown assertion values for terminal display. */

export function formatValue(value: unknown): string {
  if (value === undefined) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Short plan hash for banners (first four hex chars + ellipsis). */
export function shortPlanHash(planHash: string): string {
  const trimmed = planHash.trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}…`;
}
