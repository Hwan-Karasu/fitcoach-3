/** R04 preflight only: no target IDs, deduplication, writes or migration approval. */
export interface LegacySetSource {
  readonly accountScope: string;
  readonly sourceRowId: string;
  readonly clientId: string;
  readonly programId: string;
  readonly sessionId: string;
  readonly sessionExerciseId: string;
  readonly sourceFactId: string | null;
  readonly repsRaw: string | null;
  readonly weightRaw: string | null;
  readonly lifecycleShapeComplete?: boolean;
  readonly setDeletedAtRaw?: string | null;
  readonly sessionDeletedAtRaw?: string | null;
  readonly exerciseDeletedAtRaw?: string | null;
  readonly completedAtRaw?: string | null;
  readonly performedAtRaw?: string | null;
}

export type SourceFactReviewReason =
  | "SOURCE_FACTS_UNVERIFIED"
  | "EMPTY_SOURCE_FACT_ID"
  | "MISSING_METRIC"
  | "REPEATED_SOURCE_FACT_ID"
  | "CROSS_CLIENT_SOURCE_FACT_ID"
  | "CROSS_PROGRAM_SOURCE_FACT_ID"
  | "CROSS_SESSION_SOURCE_FACT_ID"
  | "METRIC_CONFLICT"
  | "LIFECYCLE_COLUMNS_MISSING"
  | "SET_DELETION_MARKER_PRESENT"
  | "SESSION_DELETION_MARKER_PRESENT"
  | "EXERCISE_DELETION_MARKER_PRESENT"
  | "ANY_DELETION_MARKER_PRESENT"
  | "SET_COMPLETION_MARKER_MISSING"
  | "SESSION_PERFORMANCE_TIME_MISSING";

export interface SourceFactCandidate {
  readonly source: LegacySetSource;
  /** Every physical row remains separate until its source semantics are proved. */
  readonly disposition: "BLOCKED_PENDING_SEMANTIC_REVIEW";
  readonly reviewReasons: readonly SourceFactReviewReason[];
}

function key(parts: readonly string[]): string { return JSON.stringify(parts); }

function requireProvenance(row: LegacySetSource): void {
  if ([row.accountScope, row.sourceRowId, row.clientId, row.programId,
    row.sessionId, row.sessionExerciseId].some((value) => !value.trim())) {
    throw new Error("R04_SOURCE_PROVENANCE_INCOMPLETE");
  }
}

/** Classifies source rows without claiming that any legacy row is a performed set. */
export function preflightSourceFacts(rows: readonly LegacySetSource[]): readonly SourceFactCandidate[] {
  const physicalRows = new Set<string>();
  const byFactId = new Map<string, LegacySetSource[]>();
  for (const row of rows) {
    requireProvenance(row);
    const physicalKey = key([row.accountScope, row.sourceRowId]);
    if (physicalRows.has(physicalKey)) throw new Error("R04_DUPLICATE_PHYSICAL_ROW_ID");
    physicalRows.add(physicalKey);
    if (!row.sourceFactId?.trim()) continue;
    const factKey = key([row.accountScope, row.sourceFactId]);
    const group = byFactId.get(factKey) ?? [];
    group.push(row);
    byFactId.set(factKey, group);
  }

  return rows.map((row) => {
    const reasons: SourceFactReviewReason[] = ["SOURCE_FACTS_UNVERIFIED"];
    if (!row.sourceFactId?.trim()) reasons.push("EMPTY_SOURCE_FACT_ID");
    if (row.repsRaw === null || !row.repsRaw.trim() ||
      row.weightRaw === null || !row.weightRaw.trim()) reasons.push("MISSING_METRIC");
    if (row.lifecycleShapeComplete === false) reasons.push("LIFECYCLE_COLUMNS_MISSING");
    const setDeletionMarked = row.setDeletedAtRaw != null;
    const sessionDeletionMarked = row.sessionDeletedAtRaw != null;
    const exerciseDeletionMarked = row.exerciseDeletedAtRaw != null;
    if (setDeletionMarked) reasons.push("SET_DELETION_MARKER_PRESENT");
    if (sessionDeletionMarked) reasons.push("SESSION_DELETION_MARKER_PRESENT");
    if (exerciseDeletionMarked) reasons.push("EXERCISE_DELETION_MARKER_PRESENT");
    if (setDeletionMarked || sessionDeletionMarked || exerciseDeletionMarked) {
      reasons.push("ANY_DELETION_MARKER_PRESENT");
    }
    if (row.lifecycleShapeComplete === true && !row.completedAtRaw?.trim()) {
      reasons.push("SET_COMPLETION_MARKER_MISSING");
    }
    if (row.lifecycleShapeComplete === true && !row.performedAtRaw?.trim()) {
      reasons.push("SESSION_PERFORMANCE_TIME_MISSING");
    }
    const group = row.sourceFactId?.trim()
      ? byFactId.get(key([row.accountScope, row.sourceFactId])) ?? []
      : [];
    if (group.length > 1) {
      reasons.push("REPEATED_SOURCE_FACT_ID");
      if (new Set(group.map((item) => item.clientId)).size > 1) reasons.push("CROSS_CLIENT_SOURCE_FACT_ID");
      if (new Set(group.map((item) => item.programId)).size > 1) reasons.push("CROSS_PROGRAM_SOURCE_FACT_ID");
      if (new Set(group.map((item) => item.sessionId)).size > 1) reasons.push("CROSS_SESSION_SOURCE_FACT_ID");
      if (new Set(group.map((item) => JSON.stringify([item.repsRaw, item.weightRaw]))).size > 1) {
        reasons.push("METRIC_CONFLICT");
      }
    }
    return { source: row, disposition: "BLOCKED_PENDING_SEMANTIC_REVIEW", reviewReasons: reasons };
  });
}
