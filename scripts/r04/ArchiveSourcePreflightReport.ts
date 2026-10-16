import type { LegacyArchiveSource } from "./LegacyArchiveSourceReader.ts";

export interface ArchiveSourcePreflightReport {
  readonly status: "requires-semantic-review";
  readonly physicalArchiveRows: number;
  readonly deletionMarkerRows: number;
  readonly lifecycleShapeMissingRows: number;
  readonly invalidJsonRows: number;
  readonly programSameClientRows: number;
  readonly programOtherClientRows: number;
  readonly otherClientSharedBookCandidateRows: number;
  readonly otherClientNoSameBookRows: number;
  readonly programNotFoundRows: number;
  readonly programIdMissingRows: number;
  readonly workoutArrayRows: number;
  readonly totalNestedWorkoutRows: number;
  readonly weekArrayRows: number;
  readonly declaredWorkoutCountMismatchRows: number;
  readonly targetWrites: 0;
}

function key(parts: readonly string[]): string { return JSON.stringify(parts); }

/** Counts source snapshots only; nested workouts are not imported or deduplicated here. */
export function summarizeArchiveSource(rows: readonly LegacyArchiveSource[]): ArchiveSourcePreflightReport {
  const seen = new Set<string>();
  const counts = {
    status: "requires-semantic-review" as const,
    physicalArchiveRows: rows.length,
    deletionMarkerRows: 0,
    lifecycleShapeMissingRows: 0,
    invalidJsonRows: 0,
    programSameClientRows: 0,
    programOtherClientRows: 0,
    otherClientSharedBookCandidateRows: 0,
    otherClientNoSameBookRows: 0,
    programNotFoundRows: 0,
    programIdMissingRows: 0,
    workoutArrayRows: 0,
    totalNestedWorkoutRows: 0,
    weekArrayRows: 0,
    declaredWorkoutCountMismatchRows: 0,
    targetWrites: 0 as const,
  };
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.sourceRowId.trim() || !row.clientId.trim()) {
      throw new Error("R04_ARCHIVE_PROVENANCE_INCOMPLETE");
    }
    const physicalKey = key([row.accountScope, row.sourceRowId]);
    if (seen.has(physicalKey)) throw new Error("R04_DUPLICATE_ARCHIVE_ROW_ID");
    seen.add(physicalKey);
    if (row.deletedAtRaw != null) counts.deletionMarkerRows += 1;
    if (!row.lifecycleShapeComplete) counts.lifecycleShapeMissingRows += 1;
    if (row.jsonStatus === "invalid-json") counts.invalidJsonRows += 1;
    if (row.programReferenceStatus === "same-client") counts.programSameClientRows += 1;
    else if (row.programReferenceStatus === "other-client") {
      counts.programOtherClientRows += 1;
      if (row.otherClientSharedBookCandidate) counts.otherClientSharedBookCandidateRows += 1;
      else counts.otherClientNoSameBookRows += 1;
    }
    else if (row.programReferenceStatus === "not-found") counts.programNotFoundRows += 1;
    else counts.programIdMissingRows += 1;
    if (row.workoutsStatus === "array") counts.workoutArrayRows += 1;
    if (!Number.isSafeInteger(row.workoutCount) || row.workoutCount < 0
      || !Number.isSafeInteger(counts.totalNestedWorkoutRows + row.workoutCount)) {
      throw new Error("R04_ARCHIVE_COUNT_UNSUPPORTED");
    }
    counts.totalNestedWorkoutRows += row.workoutCount;
    if (row.weeksStatus === "array") counts.weekArrayRows += 1;
    if (row.declaredWorkoutCountStatus === "mismatch") counts.declaredWorkoutCountMismatchRows += 1;
  }
  if (counts.programSameClientRows + counts.programOtherClientRows + counts.programNotFoundRows
    + counts.programIdMissingRows !== rows.length
    || counts.otherClientSharedBookCandidateRows + counts.otherClientNoSameBookRows
      !== counts.programOtherClientRows) throw new Error("R04_ARCHIVE_CLASSIFICATION_INCOMPLETE");
  return counts;
}
