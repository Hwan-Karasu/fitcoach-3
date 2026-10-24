/** Owner-confirmed v2 convention: repetitions and working weight in kilograms. */
export const LEGACY_V2_TRACKING_PROFILE = "LOAD_REPS" as const;

export function isExplicitTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

export function legacyObjectJson(raw: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/** Legacy validation convention retained while importing saved dates. */
export function isLegacyLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return year > 0 && probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}
