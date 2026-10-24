import type { DatabaseSync } from "node:sqlite";

export const NUTRITION_SOURCE_TABLES = ["food_products", "nutrition_recipes", "nutrition_days", "client_day_facts", "client_kbju_state", "nutrition_archive_weeks"] as const;
export type NutritionRaw = Readonly<Record<string, unknown>>;
export interface LegacyNutritionSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<typeof NUTRITION_SOURCE_TABLES[number], readonly NutritionRaw[] | null>>;
}
const required: Readonly<Record<typeof NUTRITION_SOURCE_TABLES[number], readonly string[]>> = {
  food_products: ["id", "name", "brand", "barcode", "serving_mode", "calories", "protein", "fat", "carbs", "favorite", "created_at", "updated_at"],
  nutrition_recipes: ["id", "name", "description", "servings", "items_json", "calories", "protein", "fat", "carbs", "saved_to_cookbook", "created_at", "updated_at"],
  nutrition_days: ["client_id", "date_key", "meals_json", "water_ml", "updated_at"],
  client_day_facts: ["client_id", "date_key", "weight", "steps", "training"],
  client_kbju_state: ["client_id", "profile_json", "manual_kbju_json", "updated_at"],
  nutrition_archive_weeks: ["id", "client_id"],
};
/** All stores share the caller's immutable source transaction. Never filters
 * unreadable/empty rows or runs legacy migrations/default normalizers. */
export function readLegacyNutritionInSnapshot(db: DatabaseSync, accountScope: string): LegacyNutritionSource {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const tables = Object.fromEntries(NUTRITION_SOURCE_TABLES.map((table) => {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) return [table, null];
    const columns = new Set(db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((r) => r.name));
    if (required[table].some((field) => !columns.has(field))) throw new Error("R04_NUTRITION_SOURCE_SHAPE_UNSUPPORTED");
    const rows = db.prepare(`SELECT * FROM ${table}`).all().map((r) => ({ ...r }));
    if (rows.length !== db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) throw new Error("R04_NUTRITION_SOURCE_COVERAGE_MISMATCH");
    return [table, rows];
  })) as LegacyNutritionSource["tables"];
  return { accountScope, tables };
}
