import type { DatabaseSync } from "node:sqlite";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyPlansSource } from "./LegacyPlansSourceReader.ts";
import { legacyPlansSchemaPlan, legacyPlansStagePlan, legacyLoadPlanMappingsPlan } from "../../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStagePlan.ts";
import type { LegacyPlanCheckpoint } from "../../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
export { plansRehearsalObjects, type PlanDraftMapping, type PlanStageCheckpoint } from "../../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStagePlan.ts";

export function createPlansRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_PLANS_TRANSACTION_REQUIRED");
  runNodeLegacyWritePlan(db, legacyPlansSchemaPlan());
}
export function stageLegacyPlansInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], clients: ClientDraftIdMap, source: LegacyPlansSource, allocate: () => string,
  checkpoint: (stage: LegacyPlanCheckpoint) => void, templatesEnabled = false, archivesEnabled = false) {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_PLANS_TRANSACTION_REQUIRED");
  return runNodeLegacyWritePlan(db, legacyPlansStagePlan(context, importedAt, cards, clients, source, allocate, templatesEnabled, archivesEnabled), (phase) => {
    if (phase !== "after-archive-plans" && !phase.startsWith("after-plan-")) throw new Error("R04_ID_LEDGER_UNEXPECTED_CHECKPOINT");
    checkpoint(phase as LegacyPlanCheckpoint);
  });
}
export function loadStagedPlanMappings(db: DatabaseSync, templatesEnabled = false) { return runNodeLegacyWritePlan(db, legacyLoadPlanMappingsPlan(templatesEnabled)); }
