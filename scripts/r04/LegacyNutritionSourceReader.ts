import type { DatabaseSync } from "node:sqlite";
import { legacyNutritionReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacySourceReadPlans.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";

export { NUTRITION_SOURCE_TABLES } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
export type { LegacyNutritionSource, LegacySourceRow as NutritionRaw } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";

/** Same full-row source plan as mobile; caller owns an immutable read snapshot. */
export function readLegacyNutritionInSnapshot(db: DatabaseSync, accountScope: string) {
  return runNodeLegacyReadPlan(db, legacyNutritionReadPlan(accountScope));
}
