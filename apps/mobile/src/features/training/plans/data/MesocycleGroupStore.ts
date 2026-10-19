import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { GroupCopy } from "../domain/Placement.ts";

/**
 * Группа мезоцикла (UI-OWN-044): копии одного родства у участников с действующим участием, кроме вышедших.
 * Вышедшая копия видит группу только из себя.
 */

type CopyRow = GroupCopy & Readonly<{ lineageId: string; leftAt: string | null }>;

export async function readCopy(tx: SqliteStatementPort, workspaceId: string, mesocycleId: string): Promise<CopyRow | null> {
  return tx.first<CopyRow>(`SELECT client_id AS clientId, program_id AS programId, id AS mesocycleId, lineage_id AS lineageId,
    group_left_at AS leftAt FROM dev_training_mesocycles WHERE workspace_id = ? AND id = ?`, [workspaceId, mesocycleId]);
}

export async function readGroup(tx: SqliteStatementPort, workspaceId: string, lineageId: string): Promise<readonly GroupCopy[]> {
  return tx.all<GroupCopy>(`SELECT m.client_id AS clientId, m.program_id AS programId, m.id AS mesocycleId
    FROM dev_training_mesocycles m JOIN dev_training_program_members pm ON pm.workspace_id = m.workspace_id
      AND pm.program_id = m.program_id AND pm.client_id = m.client_id
    WHERE m.workspace_id = ? AND m.lineage_id = ? AND m.group_left_at IS NULL AND pm.archived_at IS NULL
    ORDER BY m.created_at, m.rowid`, [workspaceId, lineageId]);
}

/** Группа глазами копии `mesocycleId`. */
export async function groupOfCopy(tx: SqliteStatementPort, workspaceId: string, mesocycleId: string): Promise<readonly GroupCopy[]> {
  const copy = await readCopy(tx, workspaceId, mesocycleId);
  if (copy === null) return [];
  const own = { clientId: copy.clientId, programId: copy.programId, mesocycleId: copy.mesocycleId };
  if (copy.leftAt !== null) return [own];
  const group = await readGroup(tx, workspaceId, copy.lineageId);
  return group.some((item) => item.mesocycleId === own.mesocycleId) ? group : [own, ...group];
}

/** Копия клиента в этом родстве (в любой его программе), включая вышедшую. */
export async function findCopy(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  lineageId: string): Promise<CopyRow | null> {
  return tx.first<CopyRow>(`SELECT client_id AS clientId, program_id AS programId, id AS mesocycleId, lineage_id AS lineageId,
    group_left_at AS leftAt FROM dev_training_mesocycles WHERE workspace_id = ? AND client_id = ? AND lineage_id = ?
    ORDER BY group_left_at IS NOT NULL, created_at LIMIT 1`, [workspaceId, clientId, lineageId]);
}
