import { legacyMeasurementFields } from "../../../../shared/migration/LegacyMeasurementSources.ts";

export type LegacyMeasurementValueStatus =
  "missing" | "decimal-dot" | "decimal-comma" | "invalid" | "nonpositive";

export interface LegacyMeasurementSource {
  readonly accountScope: string;
  readonly sourceRowId: string;
  readonly clientId: string;
  readonly dateKey: string;
  readonly ownerFound: boolean;
  readonly validLocalDate: boolean;
  readonly fieldStatuses: Readonly<Record<typeof legacyMeasurementFields[number], LegacyMeasurementValueStatus>>;
  /** Source values stay in memory for a later explicit mapping; never put them in audit output. */
  readonly fieldRawValues: Readonly<Record<typeof legacyMeasurementFields[number], unknown>>;
}

/** Reparse a frozen physical row; caller-derived status flags are never trusted. */
export function projectLegacyMeasurementSourceRow(accountScope: string, row: Readonly<Record<string, unknown>>, ownerFound: boolean): LegacyMeasurementSource {
  if (!accountScope.trim() || typeof row.id !== "string" || !row.id.trim() || typeof row.client_id !== "string" || !row.client_id.trim()
    || typeof row.date_key !== "string" || !row.date_key.trim() || legacyMeasurementFields.some((field) => !Object.hasOwn(row, field))) {
    throw new Error("R04_MEASUREMENT_PROVENANCE_INCOMPLETE");
  }
  return { accountScope, sourceRowId: row.id, clientId: row.client_id, dateKey: row.date_key, ownerFound,
    validLocalDate: isIsoLocalDate(row.date_key),
    fieldStatuses: Object.fromEntries(legacyMeasurementFields.map((field) => [field, classifyValue(row[field])])) as LegacyMeasurementSource["fieldStatuses"],
    fieldRawValues: Object.fromEntries(legacyMeasurementFields.map((field) => [field, row[field]])) as LegacyMeasurementSource["fieldRawValues"] };
}

function classifyValue(value: unknown): LegacyMeasurementValueStatus {
  if (value === null || value === "" || typeof value === "string" && !value.trim()) return "missing";
  if (typeof value !== "string" || !/^\d+(?:[.,]\d+)?$/u.test(value.trim())) return "invalid";
  const numeric = Number(value.replace(",", "."));
  if (!Number.isFinite(numeric)) return "invalid";
  if (numeric <= 0) return "nonpositive";
  return value.includes(",") ? "decimal-comma" : "decimal-dot";
}

function isIsoLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
