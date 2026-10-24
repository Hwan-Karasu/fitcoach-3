import type { DatabaseSync } from "node:sqlite";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyMeasurementsSnapshot } from "./LegacyMeasurementSourceReader.ts";
import type { LegacyMeasurementCheckpoint } from "../../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { legacyMeasurementSchemaPlan, legacyMeasurementStagePlan, legacyLoadMeasurementsPlan } from "../../apps/mobile/src/features/measurements/data/legacy-import/LegacyMeasurementStagePlan.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
export { measurementRehearsalObjects, type MeasurementStageCheckpoint } from "../../apps/mobile/src/features/measurements/data/legacy-import/LegacyMeasurementStagePlan.ts";
export function createMeasurementRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_MEASUREMENTS_TRANSACTION_REQUIRED");
  runNodeLegacyWritePlan(db, legacyMeasurementSchemaPlan());
}
export function stageLegacyMeasurementsInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string, referenceDay: string,
  cards: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, source: LegacyMeasurementsSnapshot, allocate: () => string,
  checkpoint: (stage: LegacyMeasurementCheckpoint) => void) {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_MEASUREMENTS_CONTEXT_INVALID");
  return runNodeLegacyWritePlan(db, legacyMeasurementStagePlan(context, importedAt, referenceDay, cards, ids, source, allocate), (phase) => {
    if (!phase.startsWith("after-measurement-")) throw new Error("R04_ID_LEDGER_UNEXPECTED_CHECKPOINT");
    checkpoint(phase as LegacyMeasurementCheckpoint);
  });
}
export function loadStagedMeasurements(db: DatabaseSync) { return runNodeLegacyWritePlan(db, legacyLoadMeasurementsPlan()); }
