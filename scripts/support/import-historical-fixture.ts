import { DatabaseSync } from "node:sqlite";
import { DEV_SCHEMA_OWNERS } from "../../apps/mobile/src/app/composition/devSchema.ts";
import { importLegacyDevData } from "../../apps/mobile/src/shared/db/LegacyDevImport.ts";
import { runMigrations, type MigrationStep } from "../../apps/mobile/src/shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { WriterCoordinator } from "../../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { nodeSqlitePort } from "./node-sqlite-port.ts";

/** Finish an archived synthetic chain, then exercise the real dev import into a fresh baseline file.
 * The source migration ledger is never rewritten to pretend it was created by baseline.
 */
export async function importHistoricalFixture(source: DatabaseSync, catalog: readonly MigrationStep[], ledger: string) {
  await runMigrations(new WriterCoordinator(nodeSqlitePort(source)), catalog, ledger);
  const tables = source.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%schema_migrations'`).all() as { name: string }[];
  for (const { name } of tables) source.exec(`ALTER TABLE ${name} RENAME TO dev_${name}`);
  const db = new DatabaseSync(":memory:");
  const port = nodeSqlitePort(db);
  const writer = new WriterCoordinator(port);
  for (const owner of DEV_SCHEMA_OWNERS) await runMigrations(writer, owner.chain, owner.ledger);
  await importLegacyDevData({ writer, reader: port }, nodeSqlitePort(source));
  return { db, shared: new SharedSqliteDatabase(async () => port) };
}
