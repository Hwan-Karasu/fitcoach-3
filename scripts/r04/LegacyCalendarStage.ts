import type { DatabaseSync } from "node:sqlite";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyCalendarSnapshot } from "./LegacyCalendarSnapshot.ts";
import type { LegacyCalendarCheckpoint } from "../../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { legacyCalendarSchemaPlan, legacyCalendarStagePlan, legacyLoadCalendarPlan, calendarTargetTablesFor, calendarRehearsalObjectsFor } from "../../apps/mobile/src/features/calendar/data/legacy-import/LegacyCalendarStagePlan.ts";
import { legacyAccountingStagingStatements } from "../../apps/mobile/src/features/accounting/data/legacy-import/LegacyAccountingStaging.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
export type { CalendarStageCheckpoint } from "../../apps/mobile/src/features/calendar/data/legacy-import/LegacyCalendarStagePlan.ts";
export const calendarTargetTables = calendarTargetTablesFor(legacyAccountingStagingStatements);
export const calendarRehearsalObjects = calendarRehearsalObjectsFor(legacyAccountingStagingStatements);
export function createCalendarRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_CALENDAR_TRANSACTION_REQUIRED");
  runNodeLegacyWritePlan(db, legacyCalendarSchemaPlan(legacyAccountingStagingStatements));
}
export function stageLegacyCalendarInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, source: LegacyCalendarSnapshot, allocate: () => string,
  checkpoint: (stage: LegacyCalendarCheckpoint) => void) {
  if (!db.isTransaction) throw new Error("R04_ID_LEDGER_CALENDAR_CONTEXT_INVALID");
  return runNodeLegacyWritePlan(db, legacyCalendarStagePlan(context, importedAt, cards, ids, source, allocate, legacyAccountingStagingStatements), (phase) => {
    if (!phase.startsWith("after-calendar-")) throw new Error("R04_ID_LEDGER_UNEXPECTED_CHECKPOINT");
    checkpoint(phase as LegacyCalendarCheckpoint);
  });
}
export function loadStagedCalendar(db: DatabaseSync) { return runNodeLegacyWritePlan(db, legacyLoadCalendarPlan(legacyAccountingStagingStatements)); }
