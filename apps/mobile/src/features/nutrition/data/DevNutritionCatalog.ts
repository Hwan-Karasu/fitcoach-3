import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

export const DEV_NUTRITION_LEDGER = "nutrition_schema_migrations";

/**
 * New-install development schema in the shared dev file. Каталог — общий для рабочего пространства, без привязки к клиенту.
 * Not D01 production DDL and not a build120 nutrition import.
 */
export const devNutritionCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "n01-dev-nutrition-v1-own-food-products-20261020",
  statements: [
    `CREATE TABLE dev_food_products (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
      brand TEXT CHECK (brand IS NULL OR length(trim(brand)) BETWEEN 1 AND 80),
      basis_unit TEXT NOT NULL CHECK (basis_unit IN ('G','ML','PORTION')),
      basis_amount_x10 INTEGER NOT NULL CHECK (basis_amount_x10 > 0),
      kcal_x10 INTEGER CHECK (kcal_x10 IS NULL OR kcal_x10 >= 0),
      protein_x10 INTEGER CHECK (protein_x10 IS NULL OR protein_x10 >= 0),
      fat_x10 INTEGER CHECK (fat_x10 IS NULL OR fat_x10 >= 0),
      carbs_x10 INTEGER CHECK (carbs_x10 IS NULL OR carbs_x10 >= 0),
      revision INTEGER NOT NULL CHECK (revision > 0),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (kcal_x10 IS NOT NULL OR protein_x10 IS NOT NULL OR fat_x10 IS NOT NULL OR carbs_x10 IS NOT NULL)
    )`,
    `CREATE INDEX dev_food_products_active ON dev_food_products(workspace_id, archived_at, name)`,
  ],
}];
