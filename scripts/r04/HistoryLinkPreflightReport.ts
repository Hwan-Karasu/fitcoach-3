import { preflightHistoryLinks, type HistoryReviewReason, type LegacyHistorySource } from "./HistoryLinkPreflight.ts";
import type { LegacySetSource } from "./SourceFactPreflight.ts";

export interface HistoryLinkPreflightReport {
  /** Physical history rows, not newly discovered performed sets. */
  readonly historyRows: number;
  readonly blockedHistoryRows: number;
  /** Counts rows, not unique facts. */
  readonly reasonRowCounts: Readonly<Record<HistoryReviewReason, number>>;
  readonly deletionMarkerLinkCounts: Readonly<{
    noSameClientSet: number;
    multipleSameClientSets: number;
    singleReferenceNotProof: number;
  }>;
  /** Only one same-client reference; both source lifecycle shapes must be known. */
  readonly singleReferenceDeletionCrossTab: Readonly<{
    neitherMarked: number;
    historyOnlyMarked: number;
    setSideOnlyMarked: number;
    bothMarked: number;
    unknownLifecycleShape: number;
  }>;
}

function linkKey(parts: readonly string[]): string { return JSON.stringify(parts); }

export function summarizeHistoryLinks(
  historyRows: readonly LegacyHistorySource[],
  setRows: readonly LegacySetSource[],
): HistoryLinkPreflightReport {
  const candidates = preflightHistoryLinks(historyRows, setRows);
  const reasonRowCounts: Record<HistoryReviewReason, number> = {
    HISTORY_ROW_UNVERIFIED: 0,
    EMPTY_HISTORY_FACT_ID: 0,
    NO_SAME_CLIENT_SET: 0,
    ONLY_OTHER_CLIENT_SET: 0,
    MULTIPLE_SAME_CLIENT_SETS: 0,
    SINGLE_REFERENCE_NOT_PROOF: 0,
    HISTORY_DELETION_MARKER_PRESENT: 0,
    HISTORY_LIFECYCLE_COLUMN_MISSING: 0,
  };
  const deletionMarkerLinkCounts = {
    noSameClientSet: 0,
    multipleSameClientSets: 0,
    singleReferenceNotProof: 0,
  };
  const setsByOwnerAndFact = new Map<string, LegacySetSource[]>();
  for (const row of setRows) {
    if (!row.sourceFactId?.trim()) continue;
    const key = linkKey([row.accountScope, row.clientId, row.sourceFactId]);
    const group = setsByOwnerAndFact.get(key) ?? [];
    group.push(row);
    setsByOwnerAndFact.set(key, group);
  }
  const singleReferenceDeletionCrossTab = {
    neitherMarked: 0,
    historyOnlyMarked: 0,
    setSideOnlyMarked: 0,
    bothMarked: 0,
    unknownLifecycleShape: 0,
  };
  for (const candidate of candidates) {
    for (const reason of candidate.reviewReasons) reasonRowCounts[reason] += 1;
    if (candidate.reviewReasons.includes("SINGLE_REFERENCE_NOT_PROOF")) {
      const row = candidate.source;
      const match = setsByOwnerAndFact.get(linkKey([row.accountScope, row.clientId, row.sourceFactId!]));
      if (match?.length !== 1) throw new Error("R04_HISTORY_LINK_CLASSIFICATION_INCOMPLETE");
      const set = match[0]!;
      if (row.lifecycleShapeComplete !== true || set.lifecycleShapeComplete !== true) {
        singleReferenceDeletionCrossTab.unknownLifecycleShape += 1;
      } else {
        const historyMarked = row.deletedAtRaw != null;
        const setSideMarked = set.setDeletedAtRaw != null || set.sessionDeletedAtRaw != null
          || set.exerciseDeletedAtRaw != null;
        if (historyMarked && setSideMarked) singleReferenceDeletionCrossTab.bothMarked += 1;
        else if (historyMarked) singleReferenceDeletionCrossTab.historyOnlyMarked += 1;
        else if (setSideMarked) singleReferenceDeletionCrossTab.setSideOnlyMarked += 1;
        else singleReferenceDeletionCrossTab.neitherMarked += 1;
      }
    }
    if (candidate.reviewReasons.includes("HISTORY_DELETION_MARKER_PRESENT")) {
      if (candidate.reviewReasons.includes("NO_SAME_CLIENT_SET")) deletionMarkerLinkCounts.noSameClientSet += 1;
      else if (candidate.reviewReasons.includes("MULTIPLE_SAME_CLIENT_SETS")) {
        deletionMarkerLinkCounts.multipleSameClientSets += 1;
      } else if (candidate.reviewReasons.includes("SINGLE_REFERENCE_NOT_PROOF")) {
        deletionMarkerLinkCounts.singleReferenceNotProof += 1;
      }
    }
  }
  if (Object.values(deletionMarkerLinkCounts).reduce((total, count) => total + count, 0)
    !== reasonRowCounts.HISTORY_DELETION_MARKER_PRESENT) {
    throw new Error("R04_HISTORY_LINK_CLASSIFICATION_INCOMPLETE");
  }
  if (Object.values(singleReferenceDeletionCrossTab).reduce((total, count) => total + count, 0)
    !== reasonRowCounts.SINGLE_REFERENCE_NOT_PROOF) {
    throw new Error("R04_HISTORY_LINK_CLASSIFICATION_INCOMPLETE");
  }
  return { historyRows: historyRows.length, blockedHistoryRows: candidates.length,
    reasonRowCounts, deletionMarkerLinkCounts, singleReferenceDeletionCrossTab };
}
