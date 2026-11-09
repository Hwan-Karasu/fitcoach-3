import type { DatabaseOwnerCatalog } from "../../../shared/db/DatabaseIdentity.ts";
import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import { EXERCISE_IMPORT_MATCH_MIGRATION } from "./ExerciseImportMatchStore.ts";
/**
 * Таблица квитанций прежнего движка остаётся в схеме и бэкапах (старые миграции не правятся), но движок импорта её больше не читает и не пишет:
 * повторный импорт разрешён и создаёт новую программу (ADR-042).
 */
export const TRANSFER_OWNER: DatabaseOwnerCatalog = { owner: "training-transfer", ledger: "training_transfer_schema_migrations", chain: [{ version: 1, checksum: "training-transfer-receipts-v1-20261026", statements: [
  `CREATE TABLE training_transfer_receipts(workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, source_key TEXT NOT NULL, source_hash TEXT NOT NULL, local_hash TEXT NOT NULL, program_ids_json TEXT NOT NULL CHECK(json_valid(program_ids_json)), PRIMARY KEY(workspace_id,client_id,source_key), FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE CASCADE)`,
] }, EXERCISE_IMPORT_MATCH_MIGRATION, { version: 3, checksum: "training-transfer-sheet-bindings-v3-20261027",
  statements: ["ALTER TABLE training_transfer_receipts ADD COLUMN cycle_id TEXT"] }] };

/**
 * AUD26-01: у таблицы квитанций прежнего движка переноса остаётся client_id, поэтому окончательное удаление клиента
 * обязано знать её, иначе проверка схемы (assertManifestCoversSchema) блокирует удаление любого клиента. Квитанции — служебные
 * записи переноса, не факты клиента: удаляются вместе с карточкой.
 */
export const devTransferReceiptsClientDeletionParticipant = {
  owner: "training-transfer.receipts",
  tables: ["training_transfer_receipts"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>("SELECT count(*) AS n FROM training_transfer_receipts WHERE workspace_id = ? AND client_id = ?",
      [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM training_transfer_receipts WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};
