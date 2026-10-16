import type { LegacyCalendarSource } from "./LegacyCalendarSourceReader.ts";

export interface CalendarSourcePreflightReport {
  readonly status: "requires-semantic-review";
  readonly physicalRows: number;
  readonly clientLinkedRows: number;
  readonly guestRows: number;
  readonly unassignedRows: number;
  readonly missingClientRows: number;
  readonly bothClientAndGuestRows: number;
  readonly deletionMarkerRows: number;
  readonly trainingTypeRows: number;
  readonly guestVisitTypeRows: number;
  readonly initialInstructionTypeRows: number;
  readonly unknownTypeRows: number;
  readonly invalidDateRows: number;
  readonly invalidTimeShapeRows: number;
  readonly invalidDurationRows: number;
  readonly endMismatchRows: number;
  readonly workoutFactsCreated: 0;
  readonly creditSettlementsCreated: 0;
  readonly targetWrites: 0;
}

/** Independent Calendar source classification; no workout/ledger inference. */
export function summarizeCalendarSource(rows: readonly LegacyCalendarSource[]): CalendarSourcePreflightReport {
  const seen = new Set<string>();
  const result = {
    status: "requires-semantic-review" as const, physicalRows: rows.length,
    clientLinkedRows: 0, guestRows: 0, unassignedRows: 0,
    missingClientRows: 0, bothClientAndGuestRows: 0, deletionMarkerRows: 0,
    trainingTypeRows: 0, guestVisitTypeRows: 0, initialInstructionTypeRows: 0,
    unknownTypeRows: 0, invalidDateRows: 0, invalidTimeShapeRows: 0,
    invalidDurationRows: 0, endMismatchRows: 0,
    workoutFactsCreated: 0 as const, creditSettlementsCreated: 0 as const,
    targetWrites: 0 as const,
  };
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.sourceRowId.trim()) {
      throw new Error("R04_CALENDAR_PROVENANCE_INCOMPLETE");
    }
    const key = JSON.stringify([row.accountScope, row.sourceRowId]);
    if (seen.has(key)) throw new Error("R04_DUPLICATE_CALENDAR_ROW_ID");
    seen.add(key);
    if (row.ownerStatus === "client") result.clientLinkedRows += 1;
    else if (row.ownerStatus === "guest") result.guestRows += 1;
    else if (row.ownerStatus === "unassigned") result.unassignedRows += 1;
    else if (row.ownerStatus === "missing-client") result.missingClientRows += 1;
    else result.bothClientAndGuestRows += 1;
    if (row.deleted) result.deletionMarkerRows += 1;
    if (row.typeStatus === "training") result.trainingTypeRows += 1;
    else if (row.typeStatus === "guest_visit") result.guestVisitTypeRows += 1;
    else if (row.typeStatus === "initial_instruction") result.initialInstructionTypeRows += 1;
    else result.unknownTypeRows += 1;
    if (!row.dateValid) result.invalidDateRows += 1;
    if (row.timeStatus === "invalid-shape") result.invalidTimeShapeRows += 1;
    else if (row.timeStatus === "invalid-duration") result.invalidDurationRows += 1;
    else if (row.timeStatus === "end-mismatch") result.endMismatchRows += 1;
  }
  if (result.clientLinkedRows + result.guestRows + result.unassignedRows
    + result.missingClientRows + result.bothClientAndGuestRows !== rows.length
    || result.trainingTypeRows + result.guestVisitTypeRows
    + result.initialInstructionTypeRows + result.unknownTypeRows !== rows.length) {
    throw new Error("R04_CALENDAR_CLASSIFICATION_INCOMPLETE");
  }
  return result;
}
