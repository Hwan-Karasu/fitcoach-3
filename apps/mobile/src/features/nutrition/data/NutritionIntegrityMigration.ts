import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";
import { guardRows, immutableScope, jsonArray, jsonText, preflight, validJson } from "../../../shared/db/SchemaGuards.ts";
import { ingredientsSql, snapshotSql } from "./SnapshotJsonSql.ts";

const source = (row: string): string => `NOT EXISTS (SELECT 1 FROM food_products AS product
  WHERE ${row}.source_kind = 'FOOD' AND product.id = ${row}.source_id AND product.workspace_id <> ${row}.workspace_id)
  AND NOT EXISTS (SELECT 1 FROM recipes AS recipe
  WHERE ${row}.source_kind = 'RECIPE' AND recipe.id = ${row}.source_id AND recipe.workspace_id <> ${row}.workspace_id)`;
const checks = [
  { name: "diary_source_owner", table: "food_diary_entries", valid: source, code: "OWNER_DIARY_SOURCE" },
  { name: "diary_ingredients_json", table: "food_diary_entries", valid: (row: string) => validJson(`${row}.ingredients_json`, ingredientsSql(`${row}.ingredients_json`)), code: "NUTRITION_JSON_INVALID" },
  { name: "nutrition_batch_payload_json", table: "nutrition_batch_commands", valid: (row: string) => validJson(`${row}.payload_json`,
    jsonArray(`${row}.payload_json`, "$", "payload", (item) => `${jsonText(item, "$.localDate")} AND ${jsonText(item, "$.slot")}
      AND ${snapshotSql(`json_quote(json_extract(${item}, '$.snapshot'))`)}`)), code: "NUTRITION_JSON_INVALID" },
  { name: "nutrition_batch_result_json", table: "nutrition_batch_commands", valid: (row: string) => validJson(`${row}.result_json`,
    jsonArray(`${row}.result_json`, "$", "receipt", (item) => jsonText(item, "$.id"))), code: "NUTRITION_JSON_INVALID" },
  { name: "nutrition_saved_meal_json", table: "nutrition_saved_meals", valid: (row: string) => validJson(`${row}.snapshots_json`,
    jsonArray(`${row}.snapshots_json`, "$", "snapshot", snapshotSql)), code: "NUTRITION_JSON_INVALID" },
];
export const nutritionIntegrityMigration: MigrationStep = {
  version: 2, checksum: "d01-nutrition-v2-owner-json-20261022",
  statements: [
    ...preflight("nutrition", checks),
    ...checks.flatMap((check) => guardRows(check.name, check.table, check.valid, check.code)),
    immutableScope("food_products", ["id", "workspace_id"]), immutableScope("recipes", ["id", "workspace_id"]),
    // Snapshots may outlive an absent source. Existing sources cannot change identity or disappear while used.
    ...[["food_products", "FOOD"], ["recipes", "RECIPE"]].map(([table, kind]) => `CREATE TRIGGER ${table}_diary_restrict_delete
      BEFORE DELETE ON ${table} WHEN EXISTS (SELECT 1 FROM food_diary_entries
        WHERE source_kind = '${kind}' AND source_id = OLD.id)
      BEGIN SELECT RAISE(ABORT, 'DIARY_SOURCE_IN_USE'); END`),
    // An absent source must not later be recreated under a different workspace and hijack an old snapshot.
    ...[["food_products", "FOOD"], ["recipes", "RECIPE"]].map(([table, kind]) => `CREATE TRIGGER ${table}_diary_owner_insert
      BEFORE INSERT ON ${table} WHEN EXISTS (SELECT 1 FROM food_diary_entries
        WHERE source_kind = '${kind}' AND source_id = NEW.id AND workspace_id <> NEW.workspace_id)
      BEGIN SELECT RAISE(ABORT, 'OWNER_DIARY_SOURCE'); END`),
  ],
};
