import type { DatabaseSync } from "node:sqlite";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import { projectLegacyClientProfile } from "./LegacyClientProfileProjection.ts";
import { legacyObjectJson, isExplicitTimestamp } from "../../apps/mobile/src/shared/migration/LegacyValues.ts";
import { legacyWorkDataSchemaPlan, legacyClientWorkDataStagePlan } from "../../apps/mobile/src/features/clients/data/legacy-import/LegacyClientWorkDataStagePlan.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
export { workDataRehearsalObjects } from "../../apps/mobile/src/features/clients/data/legacy-import/LegacyClientWorkDataStagePlan.ts";

export function createWorkDataRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_WORK_DATA_TRANSACTION_REQUIRED");
  runNodeLegacyWritePlan(db, legacyWorkDataSchemaPlan());
}
export function stageLegacyClientWorkDataInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, allocate: () => string, checkpoint: () => void) {
  if (!db.isTransaction || !isExplicitTimestamp(importedAt)) throw new Error("R04_ID_LEDGER_WORK_DATA_TRANSACTION_REQUIRED");
  for (const card of cards) {
    const raw = legacyObjectJson(card.raw.profile_json);
    if (raw === null) throw new Error("R04_ID_LEDGER_WORK_DATA_SCOPE_MISMATCH");
    if (projectLegacyClientProfile(raw).issues.length) throw new Error("R04_ID_LEDGER_WORK_DATA_PROFILE_BLOCKED");
  }
  return runNodeLegacyWritePlan(db, legacyClientWorkDataStagePlan(context, importedAt, cards, ids, allocate), () => checkpoint());
}
