/** Parses a decimal without binary floating-point rounding or invented precision. */
export function exactNonnegativeHundredth(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\+?\d+(?:[.,]\d{1,2})?$/u.test(text)) return null;
  const normalized = text.replace(",", ".").replace(/^\+/u, "");
  const [whole, fraction = ""] = normalized.split(".");
  const scaled = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(scaled) : null;
}

export function isExplicitTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}
