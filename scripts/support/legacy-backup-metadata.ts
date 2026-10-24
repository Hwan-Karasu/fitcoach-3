import type { DatabaseSync } from "node:sqlite";
import { createLegacyTrainingTables } from "./legacy-training-tables.ts";

/** Synthetic canonical-v25 backup metadata, matching the pinned v2 file contract.
 * These tables are test input only, never a migration or production schema.
 */
export function seedLegacyBackupMetadata(db: DatabaseSync, accountScope: string) {
  db.exec(`CREATE TABLE athlete_backup_manifest(id INTEGER PRIMARY KEY,json TEXT);
    CREATE TABLE account_database_binding(id INTEGER PRIMARY KEY,scope_key TEXT);
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT);
    INSERT INTO clients VALUES('a','synthetic-workspace');
    CREATE TABLE app_settings(key TEXT,value TEXT,updated_at TEXT);
    CREATE TABLE backup_state(id INTEGER PRIMARY KEY,database_id TEXT,data_revision INTEGER);
    INSERT INTO backup_state VALUES(1,'synthetic-database',7);`);
  createLegacyTrainingTables(db);
  db.exec("CREATE TABLE coaching_program_permissions(id TEXT)");
  const insert = db.prepare("INSERT INTO schema_migrations VALUES(?)"); for (let version = 1; version <= 25; version++) insert.run(version);
  db.prepare("INSERT INTO account_database_binding VALUES(1,?)").run(accountScope);
  db.prepare("INSERT INTO athlete_backup_manifest VALUES(1,?)").run(JSON.stringify({ type: "manual", formatVersion: 1, schemaVersion: 25,
    sourceSchemaVersion: 28, accountScopeKey: accountScope, appVersion: "2.0.0", createdAt: "2026-10-24T12:00:00.000Z",
    databaseSize: 1, backupId: "synthetic-backup", databaseId: "synthetic-database", dataRevision: 7 }));
  return updateLegacyManifestSize(db);
}
export function updateLegacyManifestSize(db: DatabaseSync): number {
  for (let attempt = 0; attempt < 4; attempt++) {
    const bytes = Number(db.prepare("PRAGMA page_count").get()!.page_count) * Number(db.prepare("PRAGMA page_size").get()!.page_size);
    const manifest = JSON.parse(db.prepare("SELECT json FROM athlete_backup_manifest WHERE id=1").get()!.json as string) as Record<string, unknown>;
    if (manifest.databaseSize === bytes) return bytes;
    db.prepare("UPDATE athlete_backup_manifest SET json=? WHERE id=1").run(JSON.stringify({ ...manifest, databaseSize: bytes }));
  }
  throw new Error("SYNTHETIC_BACKUP_SIZE_UNSTABLE");
}
