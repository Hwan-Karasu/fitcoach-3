import type { LegacySetSource } from "./SourceFactPreflight.ts";

export interface LegacyHistorySource {
  readonly accountScope: string;
  readonly sourceRowId: string;
  readonly clientId: string;
  readonly sourceFactId: string | null;
  readonly deletedAtRaw?: string | null;
  readonly lifecycleShapeComplete?: boolean;
}

export type HistoryReviewReason =
  | "HISTORY_ROW_UNVERIFIED"
  | "EMPTY_HISTORY_FACT_ID"
  | "NO_SAME_CLIENT_SET"
  | "ONLY_OTHER_CLIENT_SET"
  | "MULTIPLE_SAME_CLIENT_SETS"
  | "SINGLE_REFERENCE_NOT_PROOF"
  | "HISTORY_DELETION_MARKER_PRESENT"
  | "HISTORY_LIFECYCLE_COLUMN_MISSING";

export interface HistoryLinkCandidate {
  readonly source: LegacyHistorySource;
  readonly disposition: "BLOCKED_PENDING_SEMANTIC_REVIEW";
  readonly reviewReasons: readonly HistoryReviewReason[];
}

function key(parts: readonly string[]): string { return JSON.stringify(parts); }

/** A matching reference is a warning signal only; it is not proof of one performed set. */
export function preflightHistoryLinks(
  historyRows: readonly LegacyHistorySource[],
  setRows: readonly LegacySetSource[],
): readonly HistoryLinkCandidate[] {
  const seenRows = new Set<string>();
  const sameOwnerMatches = new Map<string, number>();
  const scopeFactOwners = new Map<string, Set<string>>();
  for (const row of setRows) {
    if (!row.sourceFactId?.trim()) continue;
    const ownerKey = key([row.accountScope, row.clientId, row.sourceFactId]);
    sameOwnerMatches.set(ownerKey, (sameOwnerMatches.get(ownerKey) ?? 0) + 1);
    const factKey = key([row.accountScope, row.sourceFactId]);
    const owners = scopeFactOwners.get(factKey) ?? new Set<string>();
    owners.add(row.clientId);
    scopeFactOwners.set(factKey, owners);
  }
  return historyRows.map((row) => {
    if (!row.accountScope.trim() || !row.sourceRowId.trim() || !row.clientId.trim()) {
      throw new Error("R04_HISTORY_PROVENANCE_INCOMPLETE");
    }
    const physicalKey = key([row.accountScope, row.sourceRowId]);
    if (seenRows.has(physicalKey)) throw new Error("R04_DUPLICATE_HISTORY_ROW_ID");
    seenRows.add(physicalKey);
    const reasons: HistoryReviewReason[] = ["HISTORY_ROW_UNVERIFIED"];
    if (row.lifecycleShapeComplete === false) reasons.push("HISTORY_LIFECYCLE_COLUMN_MISSING");
    if (row.deletedAtRaw != null) reasons.push("HISTORY_DELETION_MARKER_PRESENT");
    if (!row.sourceFactId?.trim()) {
      reasons.push("EMPTY_HISTORY_FACT_ID");
      reasons.push("NO_SAME_CLIENT_SET");
    } else {
      const same = sameOwnerMatches.get(key([row.accountScope, row.clientId, row.sourceFactId])) ?? 0;
      if (same === 0) {
        reasons.push("NO_SAME_CLIENT_SET");
        const owners = scopeFactOwners.get(key([row.accountScope, row.sourceFactId]));
        if (owners?.size && !owners.has(row.clientId)) reasons.push("ONLY_OTHER_CLIENT_SET");
      } else if (same > 1) {
        reasons.push("MULTIPLE_SAME_CLIENT_SETS");
      } else {
        reasons.push("SINGLE_REFERENCE_NOT_PROOF");
      }
    }
    return { source: row, disposition: "BLOCKED_PENDING_SEMANTIC_REVIEW", reviewReasons: reasons };
  });
}
