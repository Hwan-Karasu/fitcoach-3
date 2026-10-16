import type { DatabaseSync } from "node:sqlite";

export interface LegacyBackupInventory {
  readonly format: "sqlite-atbackup";
  readonly tableCount: number;
  readonly integrityErrors: number;
  readonly foreignKeyErrors: number;
  readonly formatVersion: number | null;
  readonly schemaVersion: number | null;
  readonly sourceSchemaVersion: number | null;
  readonly migrationRows: number;
  readonly migrationMax: number | null;
  readonly migrationLedgerContiguous: boolean;
  readonly bindingRows: number;
  readonly bindingMatchesManifest: boolean;
  readonly clientRows: number;
  readonly distinctClientWorkspaces: number;
  readonly missingClientWorkspaceRows: number;
  readonly missingRequiredShape: readonly string[];
  readonly status: "candidate" | "blocked";
  readonly reasons: readonly string[];
}

const requiredShape: Readonly<Record<string, readonly string[]>> = {
  account_database_binding: ["scope_key"],
  athlete_backup_manifest: ["json"],
  clients: ["id", "workspace_id"],
  schema_migrations: ["version"],
  training_sessions: ["id", "client_id"],
};

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

function numberField(record: Record<string, unknown> | null, field: string): number | null {
  const value = record?.[field];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function parseManifest(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/** Reads only schema, aggregate counts and equality checks; never returns PII values. */
export function inspectLegacyBackup(db: DatabaseSync): LegacyBackupInventory {
  db.exec("PRAGMA query_only = ON");
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((row) => String(row.name));
  const tables = new Set(tableNames);
  const missingRequiredShape: string[] = [];
  for (const [table, columns] of Object.entries(requiredShape)) {
    if (!tables.has(table)) { missingRequiredShape.push(table); continue; }
    const actual = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    for (const column of columns) if (!actual.has(column)) missingRequiredShape.push(`${table}.${column}`);
  }
  const hasShape = (name: string) => !missingRequiredShape.includes(name);

  const integrityErrors = db.prepare("PRAGMA integrity_check").all()
    .filter((row) => row.integrity_check !== "ok").length;
  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all().length;
  const manifestRows = tables.has("athlete_backup_manifest") && hasShape("athlete_backup_manifest.json")
    ? db.prepare("SELECT json FROM athlete_backup_manifest LIMIT 2").all() : [];
  const manifest = manifestRows.length === 1 ? parseManifest(manifestRows[0]?.json) : null;
  const formatVersion = numberField(manifest, "formatVersion");
  const schemaVersion = numberField(manifest, "schemaVersion");
  const sourceSchemaVersion = numberField(manifest, "sourceSchemaVersion");
  const migrationRows = tables.has("schema_migrations")
    ? count(db, "SELECT count(*) AS count FROM schema_migrations") : 0;
  const migrationMaxRow = tables.has("schema_migrations") && hasShape("schema_migrations.version")
    ? db.prepare("SELECT max(version) AS value FROM schema_migrations").get() as { value: number | null } | undefined : undefined;
  const migrationMax = migrationMaxRow?.value ?? null;
  const migrationVersions = tables.has("schema_migrations") && hasShape("schema_migrations.version")
    ? db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => Number(row.version)) : [];
  const migrationLedgerContiguous = migrationVersions.length === 25
    && migrationVersions.every((version, index) => version === index + 1);
  const bindingRows = tables.has("account_database_binding")
    ? count(db, "SELECT count(*) AS count FROM account_database_binding") : 0;
  const bindingMatchesManifest = bindingRows === 1 && hasShape("account_database_binding.scope_key")
    && typeof manifest?.accountScopeKey === "string" && manifest.accountScopeKey.trim().length > 0
    && (db.prepare("SELECT scope_key = ? AS matches FROM account_database_binding").get(manifest.accountScopeKey) as { matches: number } | undefined)?.matches === 1;
  const clientRows = tables.has("clients") ? count(db, "SELECT count(*) AS count FROM clients") : 0;
  const distinctClientWorkspaces = tables.has("clients") && hasShape("clients.workspace_id")
    ? count(db, "SELECT count(DISTINCT workspace_id) AS count FROM clients WHERE trim(workspace_id) <> ''") : 0;
  const missingClientWorkspaceRows = tables.has("clients") && hasShape("clients.workspace_id")
    ? count(db, "SELECT count(*) AS count FROM clients WHERE trim(workspace_id) = ''") : 0;

  const reasons: string[] = [];
  if (missingRequiredShape.length > 0) reasons.push("UNSUPPORTED_SHAPE");
  if (integrityErrors > 0) reasons.push("INTEGRITY_FAILED");
  if (foreignKeyErrors > 0) reasons.push("FOREIGN_KEYS_FAILED");
  if (manifest === null || manifestRows.length !== 1) reasons.push("MANIFEST_INVALID");
  if (formatVersion !== 1 || schemaVersion !== 25) reasons.push("UNSUPPORTED_VERSION");
  if (migrationRows !== 25 || migrationMax !== 25 || !migrationLedgerContiguous) reasons.push("MIGRATION_LEDGER_UNEXPECTED");
  if (!bindingMatchesManifest) reasons.push("BINDING_UNVERIFIED");
  if (clientRows > 0 && (distinctClientWorkspaces !== 1 || missingClientWorkspaceRows > 0)) reasons.push("WORKSPACE_AMBIGUOUS");
  return {
    format: "sqlite-atbackup", tableCount: tables.size, integrityErrors, foreignKeyErrors,
    formatVersion, schemaVersion, sourceSchemaVersion, migrationRows, migrationMax, migrationLedgerContiguous,
    bindingRows, bindingMatchesManifest, clientRows, distinctClientWorkspaces,
    missingClientWorkspaceRows,
    missingRequiredShape, status: reasons.length === 0 ? "candidate" : "blocked", reasons,
  };
}
