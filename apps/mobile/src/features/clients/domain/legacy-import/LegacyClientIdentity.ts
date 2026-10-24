import type { LegacyClientsSource } from "../../../../shared/migration/LegacyProfileSources.ts";
import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
export type ClientIdentityIssue = "MISSING_WORKSPACE" | "MISSING_NAME" |
  "INVALID_CREATED_AT" | "INVALID_UPDATED_AT" | "INVALID_ARCHIVED_AT" |
  "INVALID_DELETED_AT" | "ARCHIVED_AND_DELETED" |
  "DELETED_SOURCE_REQUIRES_POLICY";

export interface LegacyClientIdentityCandidate {
  readonly sourceIdentityKey: string;
  readonly accountScope: string;
  readonly sourceClientId: string;
  readonly sourceWorkspaceId: string | null;
  /** Private candidate data; aggregate reports never include names or source keys. */
  readonly displayName: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly archivedAt: string | null;
  readonly lifecycleCandidate: "ACTIVE" | "ARCHIVED" | "UNRESOLVED" | "DELETED_SOURCE";
  readonly issues: readonly ClientIdentityIssue[];
  readonly targetWorkspaceId: null;
  readonly targetClientId: null;
}

function nonblank(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Physical identity only: never merge clients by display name. */
export function projectLegacyClientIdentities(source: LegacyClientsSource): readonly LegacyClientIdentityCandidate[] {
  const { accountScope, rows } = source;
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row.id === "string" && seen.has(row.id)) throw new Error("R04_DUPLICATE_CLIENT_SOURCE_ID");
    if (typeof row.id === "string") seen.add(row.id);
  }
  return rows.map((row): LegacyClientIdentityCandidate => {
    const sourceClientId = nonblank(row.id);
    if (sourceClientId === null) throw new Error("R04_CLIENT_IDENTITY_PROVENANCE_INCOMPLETE");
    const sourceWorkspaceId = nonblank(row.workspace_id);
    const displayName = nonblank(row.name);
    const archivedAt = nonblank(row.archived_at);
    const deletedAt = nonblank(row.deleted_at);
    const issues: ClientIdentityIssue[] = [];
    if (sourceWorkspaceId === null) issues.push("MISSING_WORKSPACE");
    if (displayName === null) issues.push("MISSING_NAME");
    if (!isExplicitTimestamp(row.created_at)) issues.push("INVALID_CREATED_AT");
    if (!isExplicitTimestamp(row.updated_at)) issues.push("INVALID_UPDATED_AT");
    if (archivedAt !== null && !isExplicitTimestamp(archivedAt)) issues.push("INVALID_ARCHIVED_AT");
    if (deletedAt !== null) {
      if (!isExplicitTimestamp(deletedAt)) issues.push("INVALID_DELETED_AT");
      if (archivedAt !== null) issues.push("ARCHIVED_AND_DELETED");
      issues.push("DELETED_SOURCE_REQUIRES_POLICY");
    }
    return {
      sourceIdentityKey: JSON.stringify([accountScope, sourceClientId]),
      accountScope, sourceClientId, sourceWorkspaceId, displayName,
      createdAt: nonblank(row.created_at), updatedAt: nonblank(row.updated_at), archivedAt,
      lifecycleCandidate: deletedAt !== null ? "DELETED_SOURCE"
        : archivedAt !== null ? isExplicitTimestamp(archivedAt) ? "ARCHIVED" : "UNRESOLVED"
          : "ACTIVE",
      issues, targetWorkspaceId: null, targetClientId: null,
    };
  });
}

export interface ClientIdentityPreflightReport {
  readonly status: "requires-mapping";
  readonly physicalClientRows: number;
  readonly sourceWorkspaceCount: number;
  readonly activeCandidates: number;
  readonly archivedCandidates: number;
  readonly unresolvedLifecycleRows: number;
  readonly deletedSourceRows: number;
  readonly missingWorkspaceRows: number;
  readonly missingNameRows: number;
  readonly invalidTimeRows: number;
  readonly targetMappedClients: 0;
  readonly targetWrites: 0;
}

/** Source row counts only; no client names, IDs or workspaces leave the report. */
export function summarizeLegacyClientIdentity(
  rows: readonly LegacyClientIdentityCandidate[],
): ClientIdentityPreflightReport {
  const seen = new Set<string>();
  const workspaces = new Set<string>();
  let activeCandidates = 0;
  let archivedCandidates = 0;
  let unresolvedLifecycleRows = 0;
  let deletedSourceRows = 0;
  let missingWorkspaceRows = 0;
  let missingNameRows = 0;
  let invalidTimeRows = 0;
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.sourceClientId.trim()) {
      throw new Error("R04_CLIENT_IDENTITY_PROVENANCE_INCOMPLETE");
    }
    const expectedKey = JSON.stringify([row.accountScope, row.sourceClientId]);
    if (row.sourceIdentityKey !== expectedKey) throw new Error("R04_CLIENT_IDENTITY_KEY_MISMATCH");
    if (seen.has(expectedKey)) throw new Error("R04_DUPLICATE_CLIENT_SOURCE_ID");
    seen.add(expectedKey);
    if (row.sourceWorkspaceId !== null) {
      workspaces.add(JSON.stringify([row.accountScope, row.sourceWorkspaceId]));
    }
    if (row.lifecycleCandidate === "ACTIVE") activeCandidates += 1;
    else if (row.lifecycleCandidate === "ARCHIVED") archivedCandidates += 1;
    else if (row.lifecycleCandidate === "DELETED_SOURCE") deletedSourceRows += 1;
    else unresolvedLifecycleRows += 1;
    if (row.issues.includes("MISSING_WORKSPACE")) missingWorkspaceRows += 1;
    if (row.issues.includes("MISSING_NAME")) missingNameRows += 1;
    if (row.issues.some((issue) => issue.startsWith("INVALID_"))) invalidTimeRows += 1;
  }
  return {
    status: "requires-mapping", physicalClientRows: rows.length,
    sourceWorkspaceCount: workspaces.size,
    activeCandidates, archivedCandidates, unresolvedLifecycleRows, deletedSourceRows,
    missingWorkspaceRows, missingNameRows, invalidTimeRows,
    targetMappedClients: 0, targetWrites: 0,
  };
}
