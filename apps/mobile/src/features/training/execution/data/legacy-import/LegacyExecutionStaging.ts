import type { LegacyStageExtension } from "../../../../../shared/migration/LegacyStageExtension.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource } from "../../../../../shared/migration/LegacyPlanSources.ts";
import { EXECUTION_SOURCE_TABLES, type LegacyExecutionSource } from "../../../../../shared/migration/LegacyExecutionSources.ts";
import type { LegacyPlanMappingsReader } from "../../../../../shared/migration/LegacyPlanMappings.ts";
import { captureLegacySourceRow } from "../../../../../shared/migration/LegacySourceCapture.ts";
import { legacyExecutionSchemaPlan, legacyExecutionStagePlan, executionRehearsalObjects, type LegacyExecutionStageResult } from "./LegacyExecutionStagePlan.ts";

/** Composition supplies the verified plans reader; execution never imports another owner. */
export function legacyExecutionStagingExtension(plans: LegacyPlansSource, source: LegacyExecutionSource, readPlanMappings: LegacyPlanMappingsReader): LegacyStageExtension<LegacyExecutionStageResult> {
  if (Object.keys(plans.tables).length !== PLAN_SOURCE_TABLES.length || PLAN_SOURCE_TABLES.some((table) => plans.tables[table] !== null && !Array.isArray(plans.tables[table]))
    || Object.keys(source.tables).length !== EXECUTION_SOURCE_TABLES.length || EXECUTION_SOURCE_TABLES.some((table) => source.tables[table] !== null && !Array.isArray(source.tables[table]))) throw new Error("R04_ID_LEDGER_EXECUTION_SOURCE_SHAPE_INVALID");
  const planSnapshot: LegacyPlansSource = { accountScope: plans.accountScope, tables: Object.fromEntries(PLAN_SOURCE_TABLES.map((table) => [table, plans.tables[table]?.map(captureLegacySourceRow) ?? null])) as LegacyPlansSource["tables"] };
  const snapshot: LegacyExecutionSource = { accountScope: source.accountScope, tables: Object.fromEntries(EXECUTION_SOURCE_TABLES.map((table) => [table, source.tables[table]?.map(captureLegacySourceRow) ?? null])) as LegacyExecutionSource["tables"] };
  return Object.freeze<LegacyStageExtension<LegacyExecutionStageResult>>({
    modeTags: Object.freeze(["TRAINING_EXECUTIONS_REHEARSAL_V3"]),
    requiredModeTags: Object.freeze(["PROFILE_REHEARSAL_V1", "QUESTIONNAIRE_COMPOSITION_V1", "WORK_DATA_REHEARSAL_V1", "EXERCISE_REGISTRY_REHEARSAL_V1", "TRAINING_PLANS_REHEARSAL_V1", "TRAINING_TEMPLATES_REHEARSAL_V1", "TRAINING_ARCHIVES_REHEARSAL_V1"]),
    objects: Object.freeze({ ...executionRehearsalObjects }), clientWorkspaceIndex: true,
    createSchema: legacyExecutionSchemaPlan,
    stage: (context, importedAt, clients, ids, allocate) => legacyExecutionStagePlan(context, importedAt, clients, ids, planSnapshot, snapshot, allocate, readPlanMappings),
  });
}
