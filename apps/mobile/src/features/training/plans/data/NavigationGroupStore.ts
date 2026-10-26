import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { GroupCopy } from "../domain/Placement.ts";

export async function navigationGroupId(tx: SqliteStatementPort, workspaceId: string, cycleId: string): Promise<string | null> {
  return (await tx.first<{ id: string }>(`SELECT group_id AS id FROM training_navigation_members
    WHERE workspace_id = ? AND mesocycle_id = ?`, [workspaceId, cycleId]))?.id ?? null;
}

export async function navigationGroup(tx: SqliteStatementPort, workspaceId: string, cycleId: string): Promise<readonly GroupCopy[]> {
  const groupId = await navigationGroupId(tx, workspaceId, cycleId);
  if (groupId === null) {
    const own = await tx.first<GroupCopy>(`SELECT client_id AS clientId, program_id AS programId, id AS mesocycleId
      FROM training_mesocycles WHERE workspace_id = ? AND id = ?`, [workspaceId, cycleId]);
    return own === null ? [] : [own];
  }
  return tx.all<GroupCopy>(`SELECT n.client_id AS clientId, n.program_id AS programId, n.mesocycle_id AS mesocycleId
    FROM training_navigation_members n JOIN training_program_members p ON p.workspace_id = n.workspace_id
      AND p.program_id = n.program_id AND p.client_id = n.client_id
    JOIN clients c ON c.workspace_id = n.workspace_id AND c.id = n.client_id
    WHERE n.workspace_id = ? AND n.group_id = ? AND p.archived_at IS NULL AND c.lifecycle = 'ACTIVE'
    ORDER BY n.rowid`, [workspaceId, groupId]);
}

/** Called only when creating a new plan copy, never when attaching an existing cycle. */
export async function registerNavigationCopy(tx: SqliteStatementPort, workspaceId: string, copy: GroupCopy, lineageId: string): Promise<void> {
  await putNavigationMember(tx, workspaceId, `copy:${lineageId}`, copy);
}

export async function putNavigationMember(tx: SqliteStatementPort, workspaceId: string, groupId: string, copy: GroupCopy): Promise<void> {
  await tx.run(`INSERT OR IGNORE INTO training_navigation_groups(workspace_id, id) VALUES (?, ?)`, [workspaceId, groupId]);
  await tx.run(`INSERT INTO training_navigation_members(workspace_id, group_id, client_id, program_id, mesocycle_id)
    VALUES (?, ?, ?, ?, ?)`, [workspaceId, groupId, copy.clientId, copy.programId, copy.mesocycleId]);
}

export async function moveNavigationMember(tx: SqliteStatementPort, workspaceId: string, groupId: string, copy: GroupCopy): Promise<void> {
  if (await navigationGroupId(tx, workspaceId, copy.mesocycleId) === groupId) return;
  await tx.run(`DELETE FROM training_navigation_members WHERE workspace_id = ? AND mesocycle_id = ?`, [workspaceId, copy.mesocycleId]);
  await putNavigationMember(tx, workspaceId, groupId, copy);
}
