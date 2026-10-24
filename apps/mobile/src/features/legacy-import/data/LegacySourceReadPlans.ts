import type { SqlValue } from "../../../shared/db/SqlitePort.ts";
import { LEGACY_CALENDAR_COLUMNS, NUTRITION_SOURCE_TABLES, legacyMeasurementFields,
  type LegacyCalendarSnapshot, type LegacyMeasurementsSnapshot, type LegacyNutritionSource, type LegacySourceRow } from "../domain/LegacySourceSnapshots.ts";

export interface LegacyReadQuery { readonly sql: string; readonly bindings: readonly SqlValue[] }
export type LegacySourceReadPlan<Result> = Generator<LegacyReadQuery, Result, readonly LegacySourceRow[]>;
const query = (sql: string, bindings: readonly SqlValue[] = []): LegacyReadQuery => ({ sql, bindings });
const fail = (code: string): never => { throw new Error(code); };
const scope = (value: string) => { if (!value.trim()) fail("R04_ACCOUNT_SCOPE_REQUIRED"); };
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

function* present(table: string, shapeError: string): LegacySourceReadPlan<boolean> {
  const rows = yield query("SELECT type FROM sqlite_schema WHERE lower(name)=?", [table]);
  if (rows.length && (rows.length !== 1 || rows[0]!.type !== "table")) return fail(shapeError);
  return rows.length === 1;
}

function* read(table: string, required: readonly string[], shapeError: string, coverageError: string, key?: string, order: readonly string[] = []): LegacySourceReadPlan<readonly LegacySourceRow[] | null> {
  if (!(yield* present(table, shapeError))) return null;
  // table_info omits generated columns even though SELECT * returns them.
  const columns = yield query("SELECT name,hidden FROM pragma_table_xinfo(?)", [table]);
  if (!columns.length || columns.some((row) => typeof row.name !== "string" || ![0, 1, 2, 3].includes(row.hidden as number))
    || required.some((name) => !columns.some((row) => row.name === name && row.hidden === 0))) return fail(shapeError);
  const suffix = key === undefined ? "" : ' WHERE "key"=?', bindings = key === undefined ? [] : [key];
  // Expo returns SQLite INTEGER through a JS Number. Detect values it would round
  // inside SQLite, before requesting any rows containing those values.
  const unsafe = columns.filter((row) => row.hidden !== 1).map(({ name }) => `(typeof(${quoted(name as string)})='integer' AND (${quoted(name as string)}>9007199254740991 OR ${quoted(name as string)}< -9007199254740991))
    OR (typeof(${quoted(name as string)})='real' AND (${quoted(name as string)}>1.7976931348623157e308 OR ${quoted(name as string)}< -1.7976931348623157e308))`).join(" OR ");
  const unsupported = yield query(`SELECT 1 AS unsupported FROM ${quoted(table)}${suffix}${suffix ? " AND" : " WHERE"} (${unsafe}) LIMIT 1`, bindings);
  if (unsupported.length) return fail("R04_SOURCE_SQL_NUMBER_UNREPRESENTABLE");
  const rows = yield query(`SELECT * FROM ${quoted(table)}${suffix}${order.length ? ` ORDER BY ${order.map(quoted).join(",")}` : ""}`, bindings);
  const count = yield query(`SELECT count(*) AS n FROM ${quoted(table)}${suffix}`, bindings);
  if (count.length !== 1 || !Number.isSafeInteger(count[0]!.n) || rows.length !== count[0]!.n) return fail(coverageError);
  return rows.map((row) => ({ ...row }));
}
export { read as readLegacySourceTable };
export { present as legacySourceTablePresent };

const nutritionColumns: Readonly<Record<typeof NUTRITION_SOURCE_TABLES[number], readonly string[]>> = {
  food_products: ["id", "name", "brand", "barcode", "serving_mode", "calories", "protein", "fat", "carbs", "favorite", "created_at", "updated_at"],
  nutrition_recipes: ["id", "name", "description", "servings", "items_json", "calories", "protein", "fat", "carbs", "saved_to_cookbook", "created_at", "updated_at"],
  nutrition_days: ["client_id", "date_key", "meals_json", "water_ml", "updated_at"],
  client_day_facts: ["client_id", "date_key", "weight", "steps", "training"],
  client_kbju_state: ["client_id", "profile_json", "manual_kbju_json", "updated_at"],
  nutrition_archive_weeks: ["id", "client_id"],
};
export function* legacyNutritionReadPlan(accountScope: string): LegacySourceReadPlan<LegacyNutritionSource> {
  scope(accountScope);
  const tables = {} as Record<typeof NUTRITION_SOURCE_TABLES[number], readonly LegacySourceRow[] | null>;
  for (const table of NUTRITION_SOURCE_TABLES) tables[table] = yield* read(table, nutritionColumns[table], "R04_NUTRITION_SOURCE_SHAPE_UNSUPPORTED", "R04_NUTRITION_SOURCE_COVERAGE_MISMATCH");
  return { accountScope, tables };
}

export function* legacyMeasurementsReadPlan(accountScope: string): LegacySourceReadPlan<LegacyMeasurementsSnapshot> {
  scope(accountScope);
  return { accountScope, rows: yield* read("client_measurements", ["id", "client_id", "date_key", ...legacyMeasurementFields], "R04_MEASUREMENT_SHAPE_UNSUPPORTED", "R04_MEASUREMENT_CARDINALITY_MISMATCH"),
    clientDays: yield* read("client_day_facts", ["client_id", "date_key", "weight", "steps", "training"], "R04_MEASUREMENT_SHAPE_UNSUPPORTED", "R04_MEASUREMENT_CARDINALITY_MISMATCH") };
}

export function* legacyCalendarReadPlan(accountScope: string): LegacySourceReadPlan<LegacyCalendarSnapshot> {
  scope(accountScope);
  const unsupportedAccountingTables: string[] = [];
  for (const table of ["accounting_settings", "client_accounting", "session_packs", "credit_ledger", "credit_reservations", "payment_records", "client_preferred_packs"]) {
    if (yield* present(table, "R04_CALENDAR_SOURCE_SHAPE_UNSUPPORTED")) unsupportedAccountingTables.push(table);
  }
  return { accountScope, appointments: yield* read("calendar_appointments", LEGACY_CALENDAR_COLUMNS, "R04_CALENDAR_SOURCE_SHAPE_UNSUPPORTED", "R04_CALENDAR_SOURCE_COVERAGE_MISMATCH"),
    plannerRows: yield* read("app_settings", ["key", "value", "updated_at"], "R04_CALENDAR_SOURCE_SHAPE_UNSUPPORTED", "R04_CALENDAR_SOURCE_COVERAGE_MISMATCH", "calendar_planner_settings"), unsupportedAccountingTables };
}
