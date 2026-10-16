import type { LegacyNutritionDaySource } from "./LegacyNutritionDaySourceReader.ts";

export interface NutritionSourcePreflightReport {
  readonly status: "requires-semantic-review";
  readonly physicalDayRows: number;
  readonly foodCandidateDays: number;
  readonly foodCandidateEntries: number;
  readonly emptyMealDays: number;
  readonly waterOnlyDays: number;
  readonly malformedMealDays: number;
  readonly ambiguousEntryDays: number;
  readonly unknownMacroEntryRows: number;
  readonly flagWithoutFoodDays: number;
  readonly foodWithoutFlagDays: number;
  readonly unsupportedFlagDays: number;
  readonly missingOwnerDays: number;
  readonly targetWrites: 0;
}

/** P15's day predicate is food presence; legacy flag and water are diagnostics only. */
export function summarizeNutritionSource(
  rows: readonly LegacyNutritionDaySource[],
): NutritionSourcePreflightReport {
  const seen = new Set<string>();
  const result = {
    status: "requires-semantic-review" as const, physicalDayRows: rows.length,
    foodCandidateDays: 0, foodCandidateEntries: 0, emptyMealDays: 0,
    waterOnlyDays: 0, malformedMealDays: 0, ambiguousEntryDays: 0,
    unknownMacroEntryRows: 0, flagWithoutFoodDays: 0,
    foodWithoutFlagDays: 0, unsupportedFlagDays: 0, missingOwnerDays: 0,
    targetWrites: 0 as const,
  };
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.clientId.trim() || !row.dateKey.trim()) {
      throw new Error("R04_NUTRITION_PROVENANCE_INCOMPLETE");
    }
    const key = JSON.stringify([row.accountScope, row.clientId, row.dateKey]);
    if (seen.has(key)) throw new Error("R04_DUPLICATE_NUTRITION_DAY_KEY");
    seen.add(key);
    if (!row.ownerFound) {
      result.missingOwnerDays += 1;
      continue;
    }
    if (row.mealsShape !== "slots") result.malformedMealDays += 1;
    if (row.ambiguousEntryCount > 0) result.ambiguousEntryDays += 1;
    if (row.recordedFlag === "unsupported") result.unsupportedFlagDays += 1;
    if (row.mealsShape !== "slots" || row.ambiguousEntryCount > 0) continue;
    if (row.foodEntryCount > 0) {
      result.foodCandidateDays += 1;
      result.foodCandidateEntries += row.foodEntryCount;
      result.unknownMacroEntryRows += row.unknownMacroEntryCount;
      if (row.recordedFlag === "no") result.foodWithoutFlagDays += 1;
    } else {
      result.emptyMealDays += 1;
      if (row.waterPresent) result.waterOnlyDays += 1;
      if (row.recordedFlag === "yes") result.flagWithoutFoodDays += 1;
    }
  }
  if (result.foodCandidateDays + result.emptyMealDays + result.malformedMealDays
    + result.ambiguousEntryDays + result.missingOwnerDays !== rows.length) {
    throw new Error("R04_NUTRITION_CLASSIFICATION_INCOMPLETE");
  }
  return result;
}
