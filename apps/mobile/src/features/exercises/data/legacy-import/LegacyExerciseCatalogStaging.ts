import type { LegacyExerciseCatalogSource } from "../../../../shared/migration/LegacyProfileSources.ts";
import type { LegacyExerciseReferenceSource } from "../../../../shared/migration/LegacyExerciseSources.ts";
import type { LegacyStageExtension } from "../../../../shared/migration/LegacyStageExtension.ts";
import { captureLegacySourceRow } from "../../../../shared/migration/LegacySourceCapture.ts";
import { projectLegacyExerciseCatalog } from "../../domain/legacy-import/LegacyExerciseCatalogProjection.ts";
import { projectLegacyExerciseReferencesFromSource } from "../../domain/legacy-import/LegacyExerciseReferences.ts";
import { exerciseRehearsalObjects, legacyExerciseSchemaPlan, legacyExerciseCatalogStagePlan, type LegacyExerciseStageResult } from "./LegacyExerciseCatalogStagePlan.ts";

/** Inputs must come from the same SHA-verified admitted snapshot as the client stage.
 * Capture raw rows; no caller-derived catalog/reference candidate authorizes a link.
 */
export function legacyExerciseCatalogStagingExtension(catalog: LegacyExerciseCatalogSource, source: LegacyExerciseReferenceSource): LegacyStageExtension<LegacyExerciseStageResult> {
  if (catalog.accountScope !== source.accountScope) throw new Error("R04_EXERCISE_ACCOUNT_MISMATCH");
  const catalogRows = projectLegacyExerciseCatalog({ accountScope: catalog.accountScope, rows: catalog.rows.map(captureLegacySourceRow) });
  const refs = projectLegacyExerciseReferencesFromSource({ accountScope: source.accountScope,
    clients: source.clients?.map(captureLegacySourceRow) ?? null, workouts: source.workouts?.map(captureLegacySourceRow) ?? null,
    exercises: source.exercises?.map(captureLegacySourceRow) ?? null, history: source.history?.map(captureLegacySourceRow) ?? null }, catalogRows);
  return Object.freeze<LegacyStageExtension<LegacyExerciseStageResult>>({
    modeTags: Object.freeze(["EXERCISE_REGISTRY_REHEARSAL_V1"]),
    requiredModeTags: Object.freeze(["PROFILE_REHEARSAL_V1", "QUESTIONNAIRE_COMPOSITION_V1", "WORK_DATA_REHEARSAL_V1"]),
    objects: Object.freeze({ ...exerciseRehearsalObjects }), clientWorkspaceIndex: true,
    createSchema: legacyExerciseSchemaPlan,
    stage: (context, _createdAt, clients, ids, allocate) => legacyExerciseCatalogStagePlan(context, clients, ids, catalogRows, refs, allocate),
  });
}
