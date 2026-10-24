import type { DatabaseSync } from "node:sqlite";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyQuestionnaireSource } from "./LegacyQuestionnaireComposition.ts";
import { legacyClientWorkspaceIndexPlan } from "../../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStagePlan.ts";
import { legacyProfileSchemaPlan, legacyClientProfilesStagePlan } from "../../apps/mobile/src/features/questionnaire/data/legacy-import/LegacyClientProfileStagePlan.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
export { profileRehearsalObjects } from "../../apps/mobile/src/features/questionnaire/data/legacy-import/LegacyClientProfileStagePlan.ts";

export function createProfileRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_PROFILE_SCHEMA_UNAVAILABLE");
  runNodeLegacyWritePlan(db, legacyClientWorkspaceIndexPlan());
  runNodeLegacyWritePlan(db, legacyProfileSchemaPlan());
}
export function stageClientProfilesInTransaction(db: DatabaseSync, context: CandidateIdentityContext, createdAt: string,
  source: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, checkpoint: () => void,
  questionnaire?: LegacyQuestionnaireSource | null) {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_TRANSACTION_REQUIRED_EXCLUSIVE");
  return runNodeLegacyWritePlan(db, legacyClientProfilesStagePlan(context, createdAt, source, ids, questionnaire), () => checkpoint());
}