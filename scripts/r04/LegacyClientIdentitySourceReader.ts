import type { DatabaseSync } from "node:sqlite";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";

export type ClientIdentityIssue = "MISSING_WORKSPACE" | "MISSING_NAME" |
  "INVALID_CREATED_AT" | "INVALID_UPDATED_AT" | "INVALID_ARCHIVED_AT" |
  "INVALID_DELETED_AT" | "ARCHIVED_AND_DELETED" |
  "DELETED_SOURCE_REQUIRES_POLICY";

export interface LegacyClientIdentityCandidate {
  readonly sourceIdentityKey: string;
  readonly accountScope: string;
  readonly sourceClientId: string;
  readonly sourceWorkspaceId: string | null;
  /** Personal data remains only inside the reader; summaries never include it. */
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

/** Reads client identity from one already-selected legacy account snapshot. */
export function readLegacyClientIdentityInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyClientIdentityCandidate[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const required = ["id", "workspace_id", "name", "created_at", "updated_at",
    "archived_at", "deleted_at"];
  const columns = new Set(db.prepare("PRAGMA table_info('clients')").all()
    .map((row) => String(row.name)));
  if (required.some((column) => !columns.has(column))) {
    throw new Error("R04_CLIENT_IDENTITY_SHAPE_UNSUPPORTED");
  }
  const rows = db.prepare(`SELECT id AS sourceClientId, workspace_id AS sourceWorkspaceId,
    name AS displayName, created_at AS createdAt, updated_at AS updatedAt,
    archived_at AS archivedAt, deleted_at AS deletedAt FROM clients ORDER BY id`).all();
  const count = db.prepare("SELECT count(*) AS count FROM clients").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_CLIENT_IDENTITY_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyClientIdentityCandidate => {
    const sourceClientId = nonblank(row.sourceClientId);
    if (sourceClientId === null) throw new Error("R04_CLIENT_IDENTITY_PROVENANCE_INCOMPLETE");
    const sourceWorkspaceId = nonblank(row.sourceWorkspaceId);
    const displayName = nonblank(row.displayName);
    const archivedAt = nonblank(row.archivedAt);
    const deletedAt = nonblank(row.deletedAt);
    const issues: ClientIdentityIssue[] = [];
    if (sourceWorkspaceId === null) issues.push("MISSING_WORKSPACE");
    if (displayName === null) issues.push("MISSING_NAME");
    if (!isExplicitTimestamp(row.createdAt)) issues.push("INVALID_CREATED_AT");
    if (!isExplicitTimestamp(row.updatedAt)) issues.push("INVALID_UPDATED_AT");
    if (archivedAt !== null && !isExplicitTimestamp(archivedAt)) issues.push("INVALID_ARCHIVED_AT");
    if (deletedAt !== null) {
      if (!isExplicitTimestamp(deletedAt)) issues.push("INVALID_DELETED_AT");
      if (archivedAt !== null) issues.push("ARCHIVED_AND_DELETED");
      issues.push("DELETED_SOURCE_REQUIRES_POLICY");
    }
    return {
      sourceIdentityKey: JSON.stringify([accountScope, sourceClientId]),
      accountScope, sourceClientId, sourceWorkspaceId, displayName,
      createdAt: nonblank(row.createdAt), updatedAt: nonblank(row.updatedAt), archivedAt,
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
