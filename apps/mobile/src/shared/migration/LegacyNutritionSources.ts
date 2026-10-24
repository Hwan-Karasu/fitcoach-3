import type { LegacySourceRow } from "./LegacyProfileSources.ts";
export type { LegacySourceRow as NutritionRaw } from "./LegacyProfileSources.ts";

export const NUTRITION_SOURCE_TABLES = ["food_products", "nutrition_recipes", "nutrition_days", "client_day_facts", "client_kbju_state", "nutrition_archive_weeks"] as const;
export interface LegacyNutritionSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<typeof NUTRITION_SOURCE_TABLES[number], readonly LegacySourceRow[] | null>>;
}
