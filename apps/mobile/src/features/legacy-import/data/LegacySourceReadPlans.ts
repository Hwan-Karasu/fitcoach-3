import { LEGACY_CALENDAR_COLUMNS, NUTRITION_SOURCE_TABLES, legacyMeasurementFields,
  type LegacyCalendarSnapshot, type LegacyMeasurementsSnapshot, type LegacyNutritionSource, type LegacySourceRow } from "../domain/LegacySourceSnapshots.ts";
import { readLegacySourceTable as read, legacySourceTablePresent as present, type LegacySourceReadPlan } from "../../../shared/migration/LegacyReadPlan.ts";
export { readLegacySourceTable, legacySourceTablePresent, type LegacyReadQuery, type LegacySourceReadPlan } from "../../../shared/migration/LegacyReadPlan.ts";
const scope = (value: string) => { if (!value.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED"); };

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
