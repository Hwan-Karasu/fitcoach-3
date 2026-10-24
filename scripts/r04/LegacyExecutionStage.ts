import type { DatabaseSync } from "node:sqlite";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyPlansSource } from "./LegacyPlansSourceReader.ts";
import type { LegacyExecutionSource } from "./LegacyExecutionSourceReader.ts";
import { legacyExecutionSchemaPlan, legacyExecutionStagePlan, legacyLoadExecutionFactsPlan } from "../../apps/mobile/src/features/training/execution/data/legacy-import/LegacyExecutionStagePlan.ts";
import { legacyLoadPlanMappingsPlan } from "../../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStagePlan.ts";
import type { LegacyExecutionCheckpoint } from "../../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
export { executionRehearsalObjects, type ExecutionStageCheckpoint } from "../../apps/mobile/src/features/training/execution/data/legacy-import/LegacyExecutionStagePlan.ts";

export function createExecutionRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_EXECUTION_TRANSACTION_OR_CONTEXT_INVALID");
  runNodeLegacyWritePlan(db, legacyExecutionSchemaPlan());
}
export function stageLegacyExecutionsInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, plans: LegacyPlansSource, source: LegacyExecutionSource,
  allocate: () => string, checkpoint: (stage: LegacyExecutionCheckpoint) => void) {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_EXECUTION_TRANSACTION_OR_CONTEXT_INVALID");
  return runNodeLegacyWritePlan(db, legacyExecutionStagePlan(context, importedAt, cards, ids, plans, source, allocate, () => legacyLoadPlanMappingsPlan(true)), (phase) => {
    if (!phase.startsWith("after-execution-")) throw new Error("R04_ID_LEDGER_UNEXPECTED_CHECKPOINT");
    checkpoint(phase as LegacyExecutionCheckpoint);
  });
}
export function loadStagedExecutionFacts(db: DatabaseSync) { return runNodeLegacyWritePlan(db, legacyLoadExecutionFactsPlan()); }
