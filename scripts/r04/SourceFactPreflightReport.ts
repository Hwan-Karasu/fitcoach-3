import { preflightSourceFacts, type LegacySetSource, type SourceFactReviewReason } from "./SourceFactPreflight.ts";

export interface SourceFactPreflightReport {
  readonly status: "requires-semantic-review";
  /** Physical source rows, never verified performed sets. */
  readonly sourceRows: number;
  readonly blockedCandidateRows: number;
  readonly targetWrites: 0;
  /** Counts rows bearing each reason, not distinct fact groups. */
  readonly reasonRowCounts: Readonly<Record<SourceFactReviewReason, number>>;
}

/** Aggregate-only public result; source IDs and workout values never leave the process. */
export function summarizeSourceFactPreflight(rows: readonly LegacySetSource[]): SourceFactPreflightReport {
  const candidates = preflightSourceFacts(rows);
  const reasonRowCounts: Record<SourceFactReviewReason, number> = {
    SOURCE_FACTS_UNVERIFIED: 0,
    EMPTY_SOURCE_FACT_ID: 0,
    MISSING_METRIC: 0,
    REPEATED_SOURCE_FACT_ID: 0,
    CROSS_CLIENT_SOURCE_FACT_ID: 0,
    CROSS_PROGRAM_SOURCE_FACT_ID: 0,
    CROSS_SESSION_SOURCE_FACT_ID: 0,
    METRIC_CONFLICT: 0,
    LIFECYCLE_COLUMNS_MISSING: 0,
    SET_DELETION_MARKER_PRESENT: 0,
    SESSION_DELETION_MARKER_PRESENT: 0,
    EXERCISE_DELETION_MARKER_PRESENT: 0,
    ANY_DELETION_MARKER_PRESENT: 0,
    SET_COMPLETION_MARKER_MISSING: 0,
    SESSION_PERFORMANCE_TIME_MISSING: 0,
  };
  for (const candidate of candidates) {
    for (const reason of candidate.reviewReasons) reasonRowCounts[reason] += 1;
  }
  return {
    status: "requires-semantic-review",
    sourceRows: rows.length,
    blockedCandidateRows: candidates.length,
    targetWrites: 0,
    reasonRowCounts,
  };
}
