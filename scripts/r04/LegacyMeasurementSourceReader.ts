import type { DatabaseSync } from "node:sqlite";

export const legacyMeasurementFields = [
  "neck", "shoulders", "chest", "waist", "hips", "upper_arm", "thigh", "calf",
] as const;

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

export interface LegacyMeasurementsSnapshot {
  readonly accountScope: string;
  /** null means the optional source table is absent, not an observed empty table. */
  readonly rows: readonly Readonly<Record<string, unknown>>[] | null;
  readonly clientDays: readonly Readonly<Record<string, unknown>>[] | null;
}
export function readLegacyMeasurementsSnapshotInSnapshot(db: DatabaseSync, accountScope: string): LegacyMeasurementsSnapshot {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  function read(table: "client_measurements" | "client_day_facts", required: readonly string[]) {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) return null;
    const columns = new Set(db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((r) => r.name));
    if (required.some((field) => !columns.has(field))) throw new Error("R04_MEASUREMENT_SHAPE_UNSUPPORTED");
    const rows = db.prepare(`SELECT * FROM ${table}`).all().map((r) => ({ ...r }));
    if (rows.length !== db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) throw new Error("R04_MEASUREMENT_CARDINALITY_MISMATCH");
    return rows;
  }
  return { accountScope, rows: read("client_measurements", ["id", "client_id", "date_key", ...legacyMeasurementFields]),
    clientDays: read("client_day_facts", ["client_id", "date_key", "weight", "steps", "training"]) };
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

/** Legacy circumference rows are source snapshots, not normalized measurement facts. */
export function readLegacyMeasurementRowsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyMeasurementSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const columns = new Set(db.prepare("PRAGMA table_info('client_measurements')").all()
    .map((row) => String(row.name)));
  if (["id", "client_id", "date_key", ...legacyMeasurementFields]
    .some((column) => !columns.has(column))) throw new Error("R04_MEASUREMENT_SHAPE_UNSUPPORTED");
  const rows = db.prepare(`SELECT m.id AS sourceRowId, m.client_id AS clientId,
    m.date_key AS dateKey, ${legacyMeasurementFields.map((field) => `m.${field}`).join(", ")},
    c.id AS ownerClientId FROM client_measurements m
    LEFT JOIN clients c ON c.id=m.client_id ORDER BY m.id`).all();
  const count = db.prepare("SELECT count(*) AS count FROM client_measurements").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_MEASUREMENT_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyMeasurementSource => {
    if (typeof row.sourceRowId !== "string" || !row.sourceRowId.trim()
      || typeof row.clientId !== "string" || !row.clientId.trim()
      || typeof row.dateKey !== "string" || !row.dateKey.trim()) {
      throw new Error("R04_MEASUREMENT_PROVENANCE_INCOMPLETE");
    }
    const fieldStatuses = Object.fromEntries(legacyMeasurementFields.map((field) =>
      [field, classifyValue(row[field])])) as Record<typeof legacyMeasurementFields[number], LegacyMeasurementValueStatus>;
    const fieldRawValues = Object.fromEntries(legacyMeasurementFields.map((field) =>
      [field, row[field]])) as Record<typeof legacyMeasurementFields[number], unknown>;
    return {
      accountScope, sourceRowId: row.sourceRowId, clientId: row.clientId,
      dateKey: row.dateKey, ownerFound: row.ownerClientId === row.clientId,
      validLocalDate: isIsoLocalDate(row.dateKey), fieldStatuses, fieldRawValues,
    };
  });
}
