import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import { UUID_V4_SQL } from "../../../../shared/db/SqlIds.ts";
import type { Mesocycle } from "../domain/PeriodizedModel.ts";
import type { MesocycleVersion } from "../domain/StructureVersion.ts";

export async function readMesocycleHistory(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  programId: string, mesocycleId: string): Promise<readonly MesocycleVersion[]> {
  const rows = await tx.all<{ id: string; validFrom: string; validTo: string; json: string }>(`SELECT
    id, valid_from AS validFrom, valid_to AS validTo, structure_json AS json FROM dev_training_structure_versions
    WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND mesocycle_id = ? ORDER BY rowid DESC`,
  [workspaceId, clientId, programId, mesocycleId]);
  return rows.map(({ json, ...row }) => ({ ...row, structure: JSON.parse(json) as Mesocycle }));
}

export async function mesocycleCreatedAt(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  programId: string, mesocycleId: string): Promise<string> {
  const row = await tx.first<{ at: string }>(`SELECT created_at AS at FROM dev_training_mesocycles
    WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND id = ?`, [workspaceId, clientId, programId, mesocycleId]);
  if (row === null) throw new Error("TARGET_NOT_FOUND");
  return row.at;
}

/** Called inside the same transaction as the structural write, once per changed participant/cycle. */
export async function preserveMesocycle(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  programId: string, structure: Mesocycle, now: Date): Promise<void> {
  const previous = await tx.first<{ at: string }>(`SELECT valid_to AS at FROM dev_training_structure_versions
    WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND mesocycle_id = ? ORDER BY rowid DESC LIMIT 1`,
  [workspaceId, clientId, programId, structure.id]);
  const from = previous?.at ?? await mesocycleCreatedAt(tx, workspaceId, clientId, programId, structure.id);
  // A backwards device clock cannot produce a reversed interval. Ordering is also retained by rowid.
  const to = new Date(Math.max(new Date(from).getTime(), now.getTime())).toISOString();
  const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
  if (!id) throw new Error("PROGRAM_ID_UNAVAILABLE");
  await tx.run(`INSERT INTO dev_training_structure_versions
    (id, workspace_id, client_id, program_id, mesocycle_id, valid_from, valid_to, structure_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, workspaceId, clientId, programId, structure.id, from, to, JSON.stringify(structure)]);
}
