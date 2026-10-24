import type { LegacyStageExtension } from "../../../../shared/migration/LegacyStageExtension.ts";
import { NUTRITION_SOURCE_TABLES, type LegacyNutritionSource } from "../../../../shared/migration/LegacyNutritionSources.ts";
import { captureLegacySourceRow } from "../../../../shared/migration/LegacySourceCapture.ts";
import { legacyNutritionSchemaPlan, legacyNutritionStagePlan, nutritionRehearsalObjects, type LegacyNutritionStageResult } from "./LegacyNutritionStagePlan.ts";

/** Raw snapshots and complete mode are bound before opening the staging connection. */
export function legacyNutritionStagingExtension(source: LegacyNutritionSource): LegacyStageExtension<LegacyNutritionStageResult> {
  if (Object.keys(source.tables).length !== NUTRITION_SOURCE_TABLES.length || NUTRITION_SOURCE_TABLES.some((table) => source.tables[table] !== null && !Array.isArray(source.tables[table]))) throw new Error("R04_ID_LEDGER_NUTRITION_SOURCE_INVALID");
  const snapshot: LegacyNutritionSource = { accountScope: source.accountScope, tables: Object.fromEntries(NUTRITION_SOURCE_TABLES.map((table) => [table, source.tables[table]?.map(captureLegacySourceRow) ?? null])) as LegacyNutritionSource["tables"] };
  return Object.freeze<LegacyStageExtension<LegacyNutritionStageResult>>({
    modeTags: Object.freeze(["NUTRITION_REHEARSAL_V3"]),
    requiredModeTags: Object.freeze(["PROFILE_REHEARSAL_V1", "QUESTIONNAIRE_COMPOSITION_V1", "WORK_DATA_REHEARSAL_V1", "EXERCISE_REGISTRY_REHEARSAL_V1", "TRAINING_PLANS_REHEARSAL_V1", "TRAINING_TEMPLATES_REHEARSAL_V1", "TRAINING_ARCHIVES_REHEARSAL_V1", "TRAINING_EXECUTIONS_REHEARSAL_V3", "MEASUREMENTS_REHEARSAL_V2"]),
    objects: Object.freeze({ ...nutritionRehearsalObjects }), clientWorkspaceIndex: true,
    createSchema: legacyNutritionSchemaPlan,
    stage: (context, importedAt, clients, ids, allocate) => legacyNutritionStagePlan(context, importedAt, clients, ids, snapshot, allocate),
  });
}
