import type { LegacyStageExtension } from "../../../../shared/migration/LegacyStageExtension.ts";
import type { LegacyMeasurementsSnapshot } from "../../../../shared/migration/LegacyMeasurementSources.ts";
import { captureLegacySourceRow } from "../../../../shared/migration/LegacySourceCapture.ts";
import { isLocalDate } from "../../domain/MeasurementRules.ts";
import { legacyMeasurementSchemaPlan, legacyMeasurementStagePlan, measurementRehearsalObjects, type LegacyMeasurementStageResult } from "./LegacyMeasurementStagePlan.ts";

/** Fixed reference day and captured source cells make retry independent of the clock. */
export function legacyMeasurementStagingExtension(source: LegacyMeasurementsSnapshot, referenceDay: string): LegacyStageExtension<LegacyMeasurementStageResult> {
  if (!isLocalDate(referenceDay)) throw new Error("R04_ID_LEDGER_MEASUREMENTS_CONTEXT_INVALID");
  if (source.rows !== null && !Array.isArray(source.rows) || source.clientDays !== null && !Array.isArray(source.clientDays)) throw new Error("R04_ID_LEDGER_MEASUREMENTS_SOURCE_INVALID");
  const snapshot: LegacyMeasurementsSnapshot = { accountScope: source.accountScope, rows: source.rows?.map(captureLegacySourceRow) ?? null, clientDays: source.clientDays?.map(captureLegacySourceRow) ?? null };
  return Object.freeze<LegacyStageExtension<LegacyMeasurementStageResult>>({
    modeTags: Object.freeze(["MEASUREMENTS_REHEARSAL_V2", referenceDay]),
    requiredModeTags: Object.freeze(["PROFILE_REHEARSAL_V1", "QUESTIONNAIRE_COMPOSITION_V1", "WORK_DATA_REHEARSAL_V1", "EXERCISE_REGISTRY_REHEARSAL_V1", "TRAINING_PLANS_REHEARSAL_V1", "TRAINING_TEMPLATES_REHEARSAL_V1", "TRAINING_ARCHIVES_REHEARSAL_V1", "TRAINING_EXECUTIONS_REHEARSAL_V3"]),
    objects: Object.freeze({ ...measurementRehearsalObjects }), clientWorkspaceIndex: true,
    createSchema: legacyMeasurementSchemaPlan,
    stage: (context, importedAt, clients, ids, allocate) => legacyMeasurementStagePlan(context, importedAt, referenceDay, clients, ids, snapshot, allocate),
  });
}
