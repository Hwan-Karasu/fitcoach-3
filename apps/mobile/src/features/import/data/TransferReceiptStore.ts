import type { DatabaseOwnerCatalog } from "../../../shared/db/DatabaseIdentity.ts";
import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import { EXERCISE_IMPORT_MATCH_MIGRATION } from "./ExerciseImportMatchStore.ts";
export const TRANSFER_OWNER: DatabaseOwnerCatalog = { owner: "training-transfer", ledger: "training_transfer_schema_migrations", chain: [{ version: 1, checksum: "training-transfer-receipts-v1-20261026", statements: [
  `CREATE TABLE training_transfer_receipts(workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, source_key TEXT NOT NULL, source_hash TEXT NOT NULL, local_hash TEXT NOT NULL, program_ids_json TEXT NOT NULL CHECK(json_valid(program_ids_json)), PRIMARY KEY(workspace_id,client_id,source_key), FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE CASCADE)`,
] }, EXERCISE_IMPORT_MATCH_MIGRATION] };
export interface TransferReceipt { readonly sourceHash: string; readonly localHash: string; readonly programIds: string }
export class TransferReceiptStore {
  private readonly workspace: string;
  constructor(workspace: string) { this.workspace = workspace; }
  read(tx: SqliteStatementPort, client: string, key: string): Promise<TransferReceipt | null> {
    return tx.first<TransferReceipt>(`SELECT source_hash AS sourceHash, local_hash AS localHash, program_ids_json AS programIds FROM training_transfer_receipts WHERE workspace_id=? AND client_id=? AND source_key=?`, [this.workspace, client, key]);
  }
  async save(tx: SqliteStatementPort, client: string, key: string, receipt: TransferReceipt): Promise<void> {
    await tx.run(`INSERT INTO training_transfer_receipts(workspace_id,client_id,source_key,source_hash,local_hash,program_ids_json) VALUES(?,?,?,?,?,?)`, [this.workspace, client, key, receipt.sourceHash, receipt.localHash, receipt.programIds]);
  }
}
