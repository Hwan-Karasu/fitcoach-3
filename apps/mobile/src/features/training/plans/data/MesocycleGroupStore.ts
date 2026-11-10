import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { GroupCopy } from "../domain/Placement.ts";

/**
 * Группа мезоцикла (UI-OWN-044): копии одного родства у участников с действующим участием, кроме вышедших.
 * Вышедшая копия видит группу только из себя.
 */

type CopyRow = GroupCopy & Readonly<{ lineageId: string; leftAt: string | null }>;

export async function readCopy(tx: SqliteStatementPort, workspaceId: string, mesocycleId: string): Promise<CopyRow | null> {
  return tx.first<CopyRow>(`SELECT client_id AS clientId, program_id AS programId, id AS mesocycleId, lineage_id AS lineageId,
    group_left_at AS leftAt FROM training_mesocycles WHERE workspace_id = ? AND id = ?`, [workspaceId, mesocycleId]);
}

/** Копия клиента в этом родстве (в любой его программе), включая вышедшую. */
export async function findCopy(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  lineageId: string): Promise<CopyRow | null> {
  return tx.first<CopyRow>(`SELECT client_id AS clientId, program_id AS programId, id AS mesocycleId, lineage_id AS lineageId,
    group_left_at AS leftAt FROM training_mesocycles WHERE workspace_id = ? AND client_id = ? AND lineage_id = ?
    ORDER BY group_left_at IS NOT NULL, created_at LIMIT 1`, [workspaceId, clientId, lineageId]);
}
