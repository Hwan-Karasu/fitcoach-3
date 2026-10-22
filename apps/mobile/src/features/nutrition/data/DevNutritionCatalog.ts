/** D01-2: runtime catalog; the 63-step dev history is archived under scripts/d01/history. */
import { nutritionBaseline } from "./NutritionBaseline.generated.ts";
import { nutritionIntegrityMigration } from "./NutritionIntegrityMigration.ts";
export const devNutritionCatalog = [...nutritionBaseline, nutritionIntegrityMigration];
export const DEV_NUTRITION_LEDGER = "nutrition_schema_migrations";
