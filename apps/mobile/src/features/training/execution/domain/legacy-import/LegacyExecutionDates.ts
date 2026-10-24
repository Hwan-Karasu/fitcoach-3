import type { WorkoutDateEvidence } from "../WorkoutDateEvidence.ts";

export interface LegacyExecutionDate extends WorkoutDateEvidence {
  readonly forcedDay: boolean;
  readonly importedUnknown: boolean;
}
function fail(): never { throw new Error("R04_ID_LEDGER_EXECUTION_DATE_INVALID_OR_CONFLICTING"); }
const empty = (): LegacyExecutionDate => ({ precision: "UNKNOWN", actualDate: null, timestamp: null, estimatedDate: null, importedAt: null, forcedDay: false, importedUnknown: false });
function day(value: string): string {
  const d = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(d) || !Number.isFinite(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) return fail();
  return d;
}
export function legacyExecutionDate(value: unknown, status: unknown, source: unknown, importedAt: unknown, forcedDay = false): LegacyExecutionDate {
  if (status !== undefined && status !== null && status !== "" && !["exact", "derived", "imported-unknown"].includes(String(status))) return fail();
  if (source != null && source !== "" && !["explicit", "completed-at", "derived-week"].includes(String(source))) return fail();
  const imported = typeof importedAt === "string" && importedAt.trim() ? importedAt : null;
  if (importedAt != null && importedAt !== "" && imported === null) return fail();
  if (status === "imported-unknown") return { ...empty(), importedAt: imported, importedUnknown: true };
  if (value === null || value === undefined || value === "") return empty();
  if (typeof value !== "string") return fail();
  const actualDate = day(value);
  if (status === "derived" || source === "derived-week") return { ...empty(), precision: "DERIVED", estimatedDate: actualDate, importedAt: imported };
  if (forcedDay || source === "explicit" || value.length === 10) return { ...empty(), precision: "DAY", actualDate, forcedDay: forcedDay || source === "explicit" };
  const normalized = value.replace(" ", "T");
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/u.exec(normalized);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) return fail();
  if (match[5] && !Number.isFinite(Date.parse(normalized))) return fail();
  return { ...empty(), precision: match[5] ? "INSTANT" : "LOCAL_DATETIME", actualDate, timestamp: normalized, importedAt: imported };
}
function instantKey(value: string): string {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return fail();
  const fraction = (match[2] ?? "").replace(/0+$/u, "");
  // Compare every supplied fractional digit without Date.parse's millisecond
  // truncation; arbitrary precision is retained rather than rounded.
  return `${Date.parse(`${match[1]}${match[3]}`)}:${fraction}`;
}
/** Explicit manual DAY corrections override old imported-unknown snapshots.
 * Otherwise imported-unknown dominates weak cached completion timestamps. */
export function mergeLegacyExecutionDates(rows: readonly LegacyExecutionDate[]): LegacyExecutionDate {
  const forced = rows.filter((d) => d.forcedDay);
  if (forced.length) { if (new Set(forced.map((d) => d.actualDate)).size !== 1) return fail(); return forced[0]!; }
  const unknownImport = rows.find((d) => d.importedUnknown);
  if (unknownImport) return unknownImport;
  const exact = rows.filter((d) => d.actualDate !== null);
  const instants = exact.filter((d) => d.precision === "INSTANT");
  if (instants.length) {
    if (new Set(instants.map((d) => instantKey(d.timestamp!))).size !== 1) return fail();
    const selected = instants[0]!;
    if (exact.some((d) => d.precision !== "INSTANT" && d.actualDate !== selected.actualDate)) return fail();
    return selected;
  }
  if (exact.length) {
    if (new Set(exact.map((d) => d.actualDate)).size !== 1) return fail();
    const local = exact.filter((d) => d.precision === "LOCAL_DATETIME");
    if (new Set(local.map((d) => d.timestamp!.replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1"))).size > 1) return fail();
    return local[0] ?? exact[0]!;
  }
  const derived = rows.filter((d) => d.precision === "DERIVED");
  return derived.length && new Set(derived.map((d) => d.estimatedDate)).size === 1 ? derived[0]! : empty();
}
