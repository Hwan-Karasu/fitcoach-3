import type { MigrationStep } from "./MigrationRunner.ts";
import type { SqliteStatementPort } from "./SqlitePort.ts";

export interface DatabaseOwnerCatalog {
  readonly owner: string;
  readonly ledger: string;
  readonly chain: readonly MigrationStep[];
}
export interface DatabaseIdentity {
  readonly applicationId: number;
  readonly product: string;
  readonly formatVersion: number;
  readonly workspaceId: string;
}
export const DATABASE_IDENTITY_TABLE = "app_database_identity";
export class DatabaseCompatibilityError extends Error {
  readonly code: "DATABASE_INCOMPATIBLE" | "DATABASE_NEWER";
  constructor(code: "DATABASE_INCOMPATIBLE" | "DATABASE_NEWER") { super(code); this.code = code; }
}
function incompatible(): never { throw new DatabaseCompatibilityError("DATABASE_INCOMPATIBLE"); }

/** Reads only. Call before WAL configuration, migration DDL, repository initialization or seed writes. */
export async function inspectDatabaseIdentity(reader: SqliteStatementPort, identity: DatabaseIdentity,
  owners: readonly DatabaseOwnerCatalog[]): Promise<"NEW" | "OWNED"> {
  try {
    const objects = await reader.all<{ type: string; name: string }>(`SELECT type, name FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`);
    const applicationId = (await reader.first<{ application_id: number }>("PRAGMA application_id"))?.application_id;
    if (objects.length === 0 && applicationId === 0) return "NEW";
    if (applicationId !== identity.applicationId || !objects.some((row) => row.type === "table" && row.name === DATABASE_IDENTITY_TABLE)) incompatible();
    const markers = await reader.all<{ id: number; product: string; formatVersion: number; workspaceId: string }>(
      `SELECT id, product, format_version AS formatVersion, workspace_id AS workspaceId FROM ${DATABASE_IDENTITY_TABLE}`);
    const marker = markers[0];
    if (markers.length !== 1 || marker?.id !== 1 || marker.product !== identity.product || marker.workspaceId !== identity.workspaceId) incompatible();
    if (!Number.isSafeInteger(marker.formatVersion) || marker.formatVersion < 1) incompatible();
    if (marker.formatVersion > identity.formatVersion) throw new DatabaseCompatibilityError("DATABASE_NEWER");
    if (marker.formatVersion !== identity.formatVersion) incompatible();

    const expected = new Map<string, string>([[DATABASE_IDENTITY_TABLE, "table"]]);
    for (const owner of owners) {
      if (!/^[a-z][a-z0-9_]*$/u.test(owner.ledger)) incompatible();
      if (!objects.some((row) => row.type === "table" && row.name === owner.ledger)) incompatible();
      expected.set(owner.ledger, "table");
      const applied = await reader.all<{ version: number; checksum: string }>(`SELECT version, checksum FROM ${owner.ledger} ORDER BY version`);
      if (applied.length === 0) incompatible();
      for (const [index, row] of applied.entries()) {
        if (row.version !== index + 1) incompatible();
        const step = owner.chain[index];
        if (!step) throw new DatabaseCompatibilityError("DATABASE_NEWER");
        if (row.checksum !== step.checksum) incompatible();
        // These catalogs contain one DDL statement per item. TEMP preflight objects are not persisted.
        for (const sql of step.statements) {
          const create = /^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-z][a-z0-9_]*)/iu.exec(sql.trim());
          const drop = /^DROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)\s+(?:IF\s+EXISTS\s+)?["`]?([a-z][a-z0-9_]*)/iu.exec(sql.trim());
          if (create) expected.set(create[2]!, create[1]!.toLowerCase());
          if (drop) expected.delete(drop[1]!);
        }
      }
    }
    if (objects.length !== expected.size || objects.some((row) => expected.get(row.name) !== row.type)) incompatible();
    const integrity = await reader.first<{ integrity_check: string }>("PRAGMA integrity_check");
    if (integrity?.integrity_check !== "ok" || (await reader.all("PRAGMA foreign_key_check")).length > 0) incompatible();
    return "OWNED";
  } catch (error) {
    if (error instanceof DatabaseCompatibilityError) throw error;
    return incompatible();
  }
}
