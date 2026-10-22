import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, openSync, realpathSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { PRODUCTION_IDENTITY, inspectProductionDatabase } from "../../apps/mobile/src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../../apps/mobile/src/app/composition/schema.ts";
import { inspectDatabaseIdentity, type DatabaseOwnerCatalog } from "../../apps/mobile/src/shared/db/DatabaseIdentity.ts";
import { runMigrationsInTransaction } from "../../apps/mobile/src/shared/db/MigrationRunner.ts";
import { nodeSqlitePort } from "../support/node-sqlite-port.ts";

/** Host-only R06 format candidate. No working database DDL is added or changed. */
const manifestTable = "at_backup_manifest";
const backupLedger = "at_backup_schema_migrations";
const manifestDdl = `CREATE TABLE ${manifestTable} (singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  json TEXT NOT NULL CHECK (json_valid(json) AND json_type(json) = 'object'))`;
const snapshotOwner: DatabaseOwnerCatalog = { owner: "backup-snapshot", ledger: backupLedger,
  chain: [{ version: 1, checksum: createHash("sha256").update(manifestDdl).digest("hex"), statements: [manifestDdl] }] };
const backupObjects = new Set([manifestTable, backupLedger]);
export interface SnapshotManifest {
  readonly kind: "athlete-diary-snapshot";
  readonly formatVersion: 3;
  readonly backupId: string;
  readonly createdAt: string;
  readonly product: "athlete_diary";
  readonly workspaceId: string;
  readonly contentSha256: string;
}
export class SnapshotError extends Error {
  readonly code: "SNAPSHOT_INVALID" | "SNAPSHOT_INCOMPLETE_MEDIA" | "SNAPSHOT_DESTINATION_EXISTS" | "SNAPSHOT_IO_FAILED";
  constructor(code: SnapshotError["code"]) { super(code); this.code = code; }
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Streaming, typed logical checksum, not JSON.stringify of the entire database. Includes
 * all canonical tables, every raw row (even soft-deleted ones), SQL definitions and ledgers.
 * No locale/rowid dependency; equal rows have identical encodings, duplicates keep multiplicity.
 * Not a signature: checksums detect corruption, they do not authenticate the file's author.
 */
export function canonicalContentSha256(db: DatabaseSync): string {
  const hash = createHash("sha256").update("athlete-snapshot-content-v1\n");
  const feed = (value: unknown): void => {
    let tag: string; let bytes: Buffer;
    if (value === null) { tag = "null"; bytes = Buffer.alloc(0); }
    else if (typeof value === "bigint") { tag = "integer"; bytes = Buffer.from(value.toString()); }
    else if (typeof value === "number") { tag = "real"; bytes = Buffer.alloc(8); bytes.writeDoubleBE(value); }
    else if (typeof value === "string") { tag = "text"; bytes = Buffer.from(value, "utf8"); }
    else if (value instanceof Uint8Array) { tag = "blob"; bytes = Buffer.from(value); }
    else throw new SnapshotError("SNAPSHOT_INVALID");
    hash.update(`${tag}:${bytes.length}:`); hash.update(bytes); hash.update(";");
  };
  const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  for (const object of objects) {
    if (backupObjects.has(String(object.name))) continue;
    for (const key of ["type", "name", "tbl_name", "sql"]) feed(object[key]);
  }
  for (const object of objects.filter((row) => row.type === "table" && !backupObjects.has(String(row.name)))) {
    const table = String(object.name);
    feed(table);
    const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all().map((row) => String(row.name));
    for (const name of columns) feed(name);
    const fields = columns.map(quote).join(", ");
    const order = columns.map((name) => `${quote(name)} COLLATE BINARY`).join(", ");
    const statement = db.prepare(`SELECT ${fields} FROM ${quote(table)} ORDER BY ${order}`);
    statement.setReadBigInts(true);
    for (const row of statement.iterate()) {
      hash.update("row:");
      for (const name of columns) feed(row[name]);
    }
    hash.update("end-table;");
  }
  return hash.digest("hex");
}
function parseManifest(json: unknown): SnapshotManifest {
  try {
    if (typeof json !== "string") throw new Error();
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const m = value as Partial<SnapshotManifest>;
    if (m.kind !== "athlete-diary-snapshot" || m.formatVersion !== 3 || m.product !== "athlete_diary" ||
      m.workspaceId !== PRODUCTION_IDENTITY.workspaceId || typeof m.backupId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(m.backupId) ||
      typeof m.createdAt !== "string" || new Date(m.createdAt).toISOString() !== m.createdAt ||
      typeof m.contentSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(m.contentSha256) ||
      Object.keys(m).sort().join(",") !== "backupId,contentSha256,createdAt,formatVersion,kind,product,workspaceId") throw new Error();
    return m as SnapshotManifest;
  } catch { throw new SnapshotError("SNAPSHOT_INVALID"); }
}
function requireMediaCoverage(db: DatabaseSync): void {
  // Recipe photos really exist in the current feature set. Do not publish a misleadingly
  // successful DB-only backup until their bytes are embedded and restored (R06 still open).
  if (db.prepare("SELECT 1 FROM recipes WHERE json_extract(details_json, '$.photoUri') IS NOT NULL LIMIT 1").get()) {
    throw new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA");
  }
}
async function inspectSnapshot(db: DatabaseSync): Promise<SnapshotManifest> {
  if (await inspectDatabaseIdentity(nodeSqlitePort(db), PRODUCTION_IDENTITY, [...SCHEMA_OWNERS, snapshotOwner]) !== "OWNED") {
    throw new SnapshotError("SNAPSHOT_INVALID");
  }
  const rows = db.prepare(`SELECT singleton, json FROM ${manifestTable}`).all();
  if (rows.length !== 1 || rows[0]?.singleton !== 1) throw new SnapshotError("SNAPSHOT_INVALID");
  const manifest = parseManifest(rows[0].json);
  requireMediaCoverage(db);
  if (canonicalContentSha256(db) !== manifest.contentSha256) throw new SnapshotError("SNAPSHOT_INVALID");
  return manifest;
}
function reserve(file: string): void {
  try { closeSync(openSync(file, "wx", 0o600)); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
    throw new SnapshotError("SNAPSHOT_IO_FAILED");
  }
}
function noSidecars(file: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) if (existsSync(`${file}${suffix}`)) throw new SnapshotError("SNAPSHOT_INVALID");
}
function sync(file: string): void {
  const fd = openSync(file, "r+");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function typed(error: unknown): never {
  if (error instanceof SnapshotError) throw error;
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "EEXIST") throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
    if (["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EIO", "EXDEV"].includes(String(error.code))) throw new SnapshotError("SNAPSHOT_IO_FAILED");
  }
  throw new SnapshotError("SNAPSHOT_INVALID");
}
function canonicalPath(file: string): string {
  const path = join(realpathSync(dirname(file)), basename(file));
  return process.platform === "win32" ? path.toLowerCase() : path;
}

/** Native backup API, never fs.copyFile of a running DB/WAL. partial and destination must
 * be private paths on the same filesystem; new destination publication is exclusive.
 * No automatic deletion/rotation: old usable backups survive failure. */
export async function createSqliteBackup(source: DatabaseSync, partial: string, destination: string,
  metadata: Pick<SnapshotManifest, "backupId" | "createdAt">): Promise<SnapshotManifest> {
  try {
    if (canonicalPath(partial) === canonicalPath(destination)) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
    if (existsSync(destination)) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
    if (await inspectProductionDatabase(nodeSqlitePort(source)) !== "OWNED") throw new SnapshotError("SNAPSHOT_INVALID");
    reserve(partial);
    await backup(source, partial);
    const copy = new DatabaseSync(partial);
    try {
      copy.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
      if (await inspectProductionDatabase(nodeSqlitePort(copy)) !== "OWNED") throw new SnapshotError("SNAPSHOT_INVALID");
      requireMediaCoverage(copy);
      const manifest = parseManifest(JSON.stringify({ kind: "athlete-diary-snapshot", formatVersion: 3,
        product: PRODUCTION_IDENTITY.product, workspaceId: PRODUCTION_IDENTITY.workspaceId, ...metadata,
        contentSha256: canonicalContentSha256(copy) }));
      await nodeSqlitePort(copy).exclusive(async (tx) => {
        await runMigrationsInTransaction(tx, snapshotOwner.chain, snapshotOwner.ledger);
        await tx.run(`INSERT INTO ${manifestTable} (singleton, json) VALUES (1, ?)`, [JSON.stringify(manifest)]);
      });
    } finally { copy.close(); }
    sync(partial);
    const manifest = await validateSqliteBackup(partial);
    // Atomic host publication with EEXIST semantics. No half-written public filename.
    linkSync(partial, destination);
    // Once published, cleanup cannot change a committed outcome.
    try { unlinkSync(partial); } catch { /* Private duplicate can be reclaimed later. */ }
    return manifest;
  } catch (error) { return typed(error); }
}
export async function validateSqliteBackup(file: string): Promise<SnapshotManifest> {
  try {
    noSidecars(file);
    const db = new DatabaseSync(file, { readOnly: true });
    try { return await inspectSnapshot(db); } finally { db.close(); }
  } catch (error) { return typed(error); }
}

/** Preserve the source .atbackup. Remove snapshot-only metadata ONLY in a separately
 * reserved candidate, then run normal production identity/schema/integrity validation. */
export async function prepareBackupForRestore(file: string, staging: string): Promise<SnapshotManifest> {
  try {
    noSidecars(file);
    const source = new DatabaseSync(file, { readOnly: true });
    let manifest: SnapshotManifest;
    try {
      manifest = await inspectSnapshot(source);
      reserve(staging);
      await backup(source, staging);
    } finally { source.close(); }
    const candidate = new DatabaseSync(staging);
    try {
      candidate.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
      const copied = await inspectSnapshot(candidate);
      if (JSON.stringify(copied) !== JSON.stringify(manifest)) throw new SnapshotError("SNAPSHOT_INVALID");
      await nodeSqlitePort(candidate).exclusive(async (tx) => {
        await tx.run(`DROP TABLE ${manifestTable}`);
        await tx.run(`DROP TABLE ${backupLedger}`);
        if (await inspectProductionDatabase(tx) !== "OWNED" || canonicalContentSha256(candidate) !== manifest.contentSha256) {
          throw new SnapshotError("SNAPSHOT_INVALID");
        }
      });
    } finally { candidate.close(); }
    sync(staging);
    return manifest;
  } catch (error) { return typed(error); }
}
