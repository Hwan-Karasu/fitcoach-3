import type { DatabaseSync } from "node:sqlite";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyExerciseCatalogCandidate } from "./LegacyExerciseCatalogSourceReader.ts";
import type { LegacyExerciseReferenceCandidate } from "./LegacyExerciseReferencePreflight.ts";
import { legacyExerciseSchemaPlan, legacyExerciseCatalogStagePlan, legacyReadStagedExerciseCatalogPlan } from "../../apps/mobile/src/features/exercises/data/legacy-import/LegacyExerciseCatalogStagePlan.ts";
import type { LegacyExerciseCheckpoint } from "../../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
export { exerciseRehearsalObjects, type ExerciseStageCheckpoint } from "../../apps/mobile/src/features/exercises/data/legacy-import/LegacyExerciseCatalogStagePlan.ts";

export function createExerciseRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_EXERCISE_TRANSACTION_REQUIRED");
  runNodeLegacyWritePlan(db, legacyExerciseSchemaPlan());
}
export function stageLegacyExerciseCatalogInTransaction(db: DatabaseSync, context: CandidateIdentityContext,
  cards: readonly LegacyClientCardCandidate[], clients: ClientDraftIdMap, sourceCatalog: readonly LegacyExerciseCatalogCandidate[],
  sourceRefs: readonly LegacyExerciseReferenceCandidate[], allocate: () => string, checkpoint: (stage: LegacyExerciseCheckpoint) => void) {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_EXERCISE_TRANSACTION_REQUIRED");
  return runNodeLegacyWritePlan(db, legacyExerciseCatalogStagePlan(context, cards, clients, sourceCatalog, sourceRefs, allocate), (phase) => {
    if (!phase.startsWith("after-exercise-")) throw new Error("R04_ID_LEDGER_UNEXPECTED_CHECKPOINT");
    checkpoint(phase as LegacyExerciseCheckpoint);
  });
}
export function readRehearsedExerciseCatalog(db: DatabaseSync, workspaceId: string, includeArchived = false) {
  return runNodeLegacyWritePlan(db, legacyReadStagedExerciseCatalogPlan(workspaceId, includeArchived));
}
