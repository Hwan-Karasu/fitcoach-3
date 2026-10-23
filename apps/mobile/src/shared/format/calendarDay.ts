/** Strict calendar day, independent of the device timezone. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Descending known days, followed by unknown days. Callers supply identity ties. */
export function compareOptionalDays(a: string | null, b: string | null): number {
  return a === null ? b === null ? 0 : 1 : b === null ? -1 : b.localeCompare(a);
}
