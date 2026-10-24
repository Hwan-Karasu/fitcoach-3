import type { DatabaseSync } from "node:sqlite";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyNutritionSource } from "./LegacyNutritionSourceReader.ts";
import type { LegacyNutritionCheckpoint } from "../../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { legacyNutritionSchemaPlan, legacyNutritionStagePlan, legacyLoadNutritionPlan, legacyLoadNutritionArchivesPlan } from "../../apps/mobile/src/features/nutrition/data/legacy-import/LegacyNutritionStagePlan.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
export { nutritionNativeTables, nutritionTargetTables, nutritionRehearsalObjects, type NutritionStageCheckpoint } from "../../apps/mobile/src/features/nutrition/data/legacy-import/LegacyNutritionStagePlan.ts";
export function createNutritionRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_NUTRITION_TRANSACTION_REQUIRED");
  runNodeLegacyWritePlan(db, legacyNutritionSchemaPlan());
}
export function stageLegacyNutritionInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, source: LegacyNutritionSource, allocate: () => string,
  checkpoint: (stage: LegacyNutritionCheckpoint) => void) {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_NUTRITION_CONTEXT_INVALID");
  return runNodeLegacyWritePlan(db, legacyNutritionStagePlan(context, importedAt, cards, ids, source, allocate), (phase) => {
    if (!phase.startsWith("after-nutrition-")) throw new Error("R04_ID_LEDGER_UNEXPECTED_CHECKPOINT");
    checkpoint(phase as LegacyNutritionCheckpoint);
  });
}
export function loadStagedNutrition(db: DatabaseSync) { return runNodeLegacyWritePlan(db, legacyLoadNutritionPlan()); }
export function loadStagedNutritionArchives(db: DatabaseSync, workspaceId: string, clientId: string) { return runNodeLegacyWritePlan(db, legacyLoadNutritionArchivesPlan(workspaceId, clientId)); }
