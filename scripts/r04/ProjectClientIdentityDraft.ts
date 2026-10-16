import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";
import type { LegacyClientIdentityCandidate } from "./LegacyClientIdentitySourceReader.ts";

export interface ClientDraftIdMap {
  /** Key: JSON.stringify([accountScope, sourceWorkspaceId]). */
  readonly workspaces: ReadonlyMap<string, string>;
  /** Key: sourceIdentityKey. IDs must be allocated and persisted by a later staging owner. */
  readonly clients: ReadonlyMap<string, string>;
}

export interface ClientTargetDraft {
  readonly id: string;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly lifecycle: "ACTIVE" | "ARCHIVED";
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Kept in provenance until the production archive model is approved. */
  readonly sourceArchivedAt: string | null;
  readonly sourceIdentityKey: string;
}

export type ClientDraftBlocker = "INVALID_SOURCE_IDENTITY" | "SOURCE_ROW_UNRESOLVED" |
  "SOURCE_ROW_DELETED" | "WORKSPACE_MAPPING_MISSING" | "CLIENT_MAPPING_MISSING" |
  "INVALID_TARGET_ID" | "TARGET_WORKSPACE_COLLISION" | "TARGET_CLIENT_COLLISION";

export type ClientDraftProjection =
  | Readonly<{
    status: "projected-draft";
    rows: readonly ClientTargetDraft[];
    physicalSourceRows: number;
    targetDraftRows: number;
    targetWrites: 0;
  }>
  | Readonly<{
    status: "blocked";
    reasons: readonly ClientDraftBlocker[];
    physicalSourceRows: number;
    targetDraftRows: 0;
    targetWrites: 0;
  }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** All-or-nothing in-memory R04 projection; no schema creation or database write. */
export function projectClientIdentityDrafts(
  source: readonly LegacyClientIdentityCandidate[], ids: ClientDraftIdMap,
): ClientDraftProjection {
  const reasons = new Set<ClientDraftBlocker>();
  const seenSource = new Set<string>();
  const targetWorkspaces = new Map<string, string>();
  const targetClients = new Set<string>();
  const rows: ClientTargetDraft[] = [];
  for (const client of source) {
    const sourceKey = JSON.stringify([client.accountScope, client.sourceClientId]);
    if (!client.accountScope.trim() || !client.sourceClientId.trim()
      || client.sourceIdentityKey !== sourceKey || seenSource.has(sourceKey)) {
      reasons.add("INVALID_SOURCE_IDENTITY");
      continue;
    }
    seenSource.add(sourceKey);
    if (client.lifecycleCandidate === "DELETED_SOURCE") reasons.add("SOURCE_ROW_DELETED");
    if (client.issues.length > 0 || client.lifecycleCandidate === "UNRESOLVED"
      || client.displayName === null || client.sourceWorkspaceId === null
      || !isExplicitTimestamp(client.createdAt) || !isExplicitTimestamp(client.updatedAt)
      || (client.lifecycleCandidate === "ARCHIVED"
        && !isExplicitTimestamp(client.archivedAt))) {
      reasons.add("SOURCE_ROW_UNRESOLVED");
    }
    const workspaceSourceKey = client.sourceWorkspaceId === null ? null
      : JSON.stringify([client.accountScope, client.sourceWorkspaceId]);
    const workspaceId = workspaceSourceKey === null ? undefined
      : ids.workspaces.get(workspaceSourceKey);
    const clientId = ids.clients.get(sourceKey);
    if (workspaceId === undefined) reasons.add("WORKSPACE_MAPPING_MISSING");
    if (clientId === undefined) reasons.add("CLIENT_MAPPING_MISSING");
    if ((workspaceId !== undefined && !UUID.test(workspaceId))
      || (clientId !== undefined && !UUID.test(clientId))) reasons.add("INVALID_TARGET_ID");
    if (workspaceId !== undefined && workspaceSourceKey !== null) {
      const previous = targetWorkspaces.get(workspaceId);
      if (previous !== undefined && previous !== workspaceSourceKey) {
        reasons.add("TARGET_WORKSPACE_COLLISION");
      }
      targetWorkspaces.set(workspaceId, workspaceSourceKey);
    }
    if (clientId !== undefined) {
      if (targetClients.has(clientId)) reasons.add("TARGET_CLIENT_COLLISION");
      targetClients.add(clientId);
    }
    if (client.displayName !== null && client.sourceWorkspaceId !== null
      && workspaceId !== undefined && clientId !== undefined
      && isExplicitTimestamp(client.createdAt) && isExplicitTimestamp(client.updatedAt)
      && (client.lifecycleCandidate === "ACTIVE" || client.lifecycleCandidate === "ARCHIVED")) {
      rows.push({
        id: clientId, workspaceId, displayName: client.displayName,
        lifecycle: client.lifecycleCandidate, createdAt: client.createdAt,
        updatedAt: client.updatedAt, sourceArchivedAt: client.archivedAt,
        sourceIdentityKey: sourceKey,
      });
    }
  }
  if (reasons.size > 0 || rows.length !== source.length) {
    return {
      status: "blocked", reasons: [...reasons], physicalSourceRows: source.length,
      targetDraftRows: 0, targetWrites: 0,
    };
  }
  return {
    status: "projected-draft", rows, physicalSourceRows: source.length,
    targetDraftRows: rows.length, targetWrites: 0,
  };
}
