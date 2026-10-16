import type { LegacyCurrentSetSource } from "./LegacyCurrentSetSourceReader.ts";
import type { LegacySetSource } from "./SourceFactPreflight.ts";

type LinkClass = "noSameClientSessionSet" | "singleReferenceNotProof"
  | "multipleSameClientSessionSets" | "unresolvedOriginRows";
type LifecycleClass = "completedOnly" | "deletionOnly" | "completedAndDeleted"
  | "neitherMarked" | "unknownLifecycleShape";
type StateByLink = Readonly<Record<LinkClass, Readonly<Record<LifecycleClass, number>>>>;

export type CurrentSetLinkPreflightReport = Readonly<{
  status: "not-observed-in-source";
  targetWrites: 0;
}> | Readonly<{
  status: "requires-semantic-review";
  physicalCurrentSetRows: number;
  completedMarkerRows: number;
  setSideDeletionMarkerRows: number;
  lifecycleShapeMissingRows: number;
  historyOriginIdRows: number;
  invalidJsonRows: number;
  unsupportedOriginRows: number;
  noSameClientSessionSet: number;
  onlyOtherClientSessionSet: number;
  singleReferenceNotProof: number;
  multipleSameClientSessionSets: number;
  unresolvedOriginRows: number;
  /** Physical row partition; no cell represents a proved performed fact. */
  stateByLink: StateByLink;
  targetWrites: 0;
}>;

function key(parts: readonly string[]): string { return JSON.stringify(parts); }
function emptyLifecycleCounts(): Record<LifecycleClass, number> {
  return { completedOnly: 0, deletionOnly: 0, completedAndDeleted: 0,
    neitherMarked: 0, unknownLifecycleShape: 0 };
}

/** Links two legacy materializations only by explicit source/client scope; never deduplicates them. */
export function summarizeCurrentSetLinks(
  currentRows: readonly LegacyCurrentSetSource[],
  sessionSetRows: readonly LegacySetSource[],
): CurrentSetLinkPreflightReport {
  const sessionMatches = new Map<string, number>();
  const scopeFactOwners = new Map<string, Set<string>>();
  for (const row of sessionSetRows) {
    if (!row.sourceFactId?.trim()) continue;
    const ownerKey = key([row.accountScope, row.clientId, row.sourceFactId]);
    sessionMatches.set(ownerKey, (sessionMatches.get(ownerKey) ?? 0) + 1);
    const factKey = key([row.accountScope, row.sourceFactId]);
    const owners = scopeFactOwners.get(factKey) ?? new Set<string>();
    owners.add(row.clientId);
    scopeFactOwners.set(factKey, owners);
  }
  const seenPhysicalRows = new Set<string>();
  const stateByLink: Record<LinkClass, Record<LifecycleClass, number>> = {
    noSameClientSessionSet: emptyLifecycleCounts(),
    singleReferenceNotProof: emptyLifecycleCounts(),
    multipleSameClientSessionSets: emptyLifecycleCounts(),
    unresolvedOriginRows: emptyLifecycleCounts(),
  };
  const counts = {
    status: "requires-semantic-review" as const,
    physicalCurrentSetRows: currentRows.length,
    completedMarkerRows: 0,
    setSideDeletionMarkerRows: 0,
    lifecycleShapeMissingRows: 0,
    historyOriginIdRows: 0,
    invalidJsonRows: 0,
    unsupportedOriginRows: 0,
    noSameClientSessionSet: 0,
    onlyOtherClientSessionSet: 0,
    singleReferenceNotProof: 0,
    multipleSameClientSessionSets: 0,
    unresolvedOriginRows: 0,
    stateByLink,
    targetWrites: 0 as const,
  };
  for (const row of currentRows) {
    if (!row.accountScope.trim() || !row.sourceRowId.trim() || !row.clientId.trim()) {
      throw new Error("R04_CURRENT_SOURCE_PROVENANCE_INCOMPLETE");
    }
    const physicalKey = key([row.accountScope, row.sourceRowId]);
    if (seenPhysicalRows.has(physicalKey)) throw new Error("R04_DUPLICATE_CURRENT_SOURCE_ROW_ID");
    seenPhysicalRows.add(physicalKey);
    const completedMarked = row.completedAtRaw != null;
    const deletionMarked = row.setDeletedAtRaw != null || row.exerciseDeletedAtRaw != null
      || row.workoutDeletedAtRaw != null;
    if (completedMarked) counts.completedMarkerRows += 1;
    if (deletionMarked) {
      counts.setSideDeletionMarkerRows += 1;
    }
    if (!row.lifecycleShapeComplete) counts.lifecycleShapeMissingRows += 1;
    if (row.originStatus === "history-origin-id") counts.historyOriginIdRows += 1;
    if (row.originStatus === "invalid-json") counts.invalidJsonRows += 1;
    if (row.originStatus === "unsupported-origin") counts.unsupportedOriginRows += 1;
    let linkClass: LinkClass;
    if (!row.effectiveSourceFactId?.trim()) {
      counts.unresolvedOriginRows += 1;
      linkClass = "unresolvedOriginRows";
    } else {
      const matches = sessionMatches.get(key([row.accountScope, row.clientId, row.effectiveSourceFactId])) ?? 0;
      if (matches === 0) {
        counts.noSameClientSessionSet += 1;
        linkClass = "noSameClientSessionSet";
        const owners = scopeFactOwners.get(key([row.accountScope, row.effectiveSourceFactId]));
        if (owners?.size && !owners.has(row.clientId)) counts.onlyOtherClientSessionSet += 1;
      } else if (matches === 1) {
        counts.singleReferenceNotProof += 1;
        linkClass = "singleReferenceNotProof";
      } else {
        counts.multipleSameClientSessionSets += 1;
        linkClass = "multipleSameClientSessionSets";
      }
    }
    const lifecycleClass: LifecycleClass = !row.lifecycleShapeComplete ? "unknownLifecycleShape"
      : completedMarked && deletionMarked ? "completedAndDeleted"
        : completedMarked ? "completedOnly" : deletionMarked ? "deletionOnly" : "neitherMarked";
    stateByLink[linkClass][lifecycleClass] += 1;
  }
  if (counts.noSameClientSessionSet + counts.singleReferenceNotProof
    + counts.multipleSameClientSessionSets + counts.unresolvedOriginRows !== currentRows.length) {
    throw new Error("R04_CURRENT_LINK_CLASSIFICATION_INCOMPLETE");
  }
  for (const linkClass of Object.keys(stateByLink) as LinkClass[]) {
    const total = Object.values(stateByLink[linkClass]).reduce((sum, value) => sum + value, 0);
    if (total !== counts[linkClass]) throw new Error("R04_CURRENT_LINK_CLASSIFICATION_INCOMPLETE");
  }
  return counts;
}
