import { DATABASE_IDENTITY_TABLE, inspectDatabaseIdentity, type DatabaseIdentity } from "../../shared/db/DatabaseIdentity.ts";
import { runMigrationsInTransaction } from "../../shared/db/MigrationRunner.ts";
import type { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteStatementPort } from "../../shared/db/SqlitePort.ts";
import { SCHEMA_OWNERS } from "./schema.ts";

// Internal filename retained from the D01 decision; the displayed product name is «Дневник атлета».
export const PRODUCTION_DATABASE = "fitcoach_v3.db";
export const PRODUCTION_WORKSPACE_ID = "local-trainer";
export const PRODUCTION_IDENTITY: DatabaseIdentity = {
  applicationId: 0x41544c44, // ATLD
  product: "athlete_diary", formatVersion: 1, workspaceId: PRODUCTION_WORKSPACE_ID,
};
export const inspectProductionDatabase = (reader: SqliteStatementPort) => inspectDatabaseIdentity(reader, PRODUCTION_IDENTITY, SCHEMA_OWNERS);

/** One transaction claims an empty file, creates all owner schemas and the local trainer workspace.
 * No client fixtures, no dev import and no legacy-source file access.
 */
export async function prepareProductionDatabase(database: SharedSqliteDatabase): Promise<void> {
  const lease = await database.acquire();
  try {
    await lease.writer.write(async (tx) => {
      const state = await inspectProductionDatabase(tx);
      if (state === "NEW") {
        await tx.run(`CREATE TABLE ${DATABASE_IDENTITY_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1),
          product TEXT NOT NULL, format_version INTEGER NOT NULL CHECK (format_version > 0), workspace_id TEXT NOT NULL)`);
        await tx.run(`INSERT INTO ${DATABASE_IDENTITY_TABLE} (id, product, format_version, workspace_id) VALUES (1, ?, ?, ?)`,
          [PRODUCTION_IDENTITY.product, PRODUCTION_IDENTITY.formatVersion, PRODUCTION_WORKSPACE_ID]);
        await tx.run(`PRAGMA application_id = ${PRODUCTION_IDENTITY.applicationId}`);
      }
      for (const owner of SCHEMA_OWNERS) await runMigrationsInTransaction(tx, owner.chain, owner.ledger);
      await tx.run("INSERT OR IGNORE INTO workspaces (id, display_name, created_at) VALUES (?, ?, ?)",
        [PRODUCTION_WORKSPACE_ID, "Локальное рабочее пространство", new Date().toISOString()]);
    });
  } finally { await database.release(); }
}
