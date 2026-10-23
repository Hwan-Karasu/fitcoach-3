import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, openSync, realpathSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { PRODUCTION_IDENTITY, inspectProductionDatabase } from "../../apps/mobile/src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../../apps/mobile/src/app/composition/schema.ts";
import { nodeSqlitePort } from "../support/node-sqlite-port.ts";
import { SnapshotError, type SnapshotManifest } from "./SnapshotContract.ts";
import { originalPhotoJsonForParity, type RestoredRecipePhoto } from "./SqliteBackupMedia.ts";
import { SqliteSnapshotEngine } from "../../apps/mobile/src/features/backup/data/SqliteSnapshotEngine.ts";
import { SNAPSHOT_OBJECTS } from "../../apps/mobile/src/features/backup/data/SnapshotCatalog.ts";
import { nodeSnapshotSql } from "./NodeSnapshotSql.ts";
import { nodeSnapshotMediaSettings, type SnapshotMediaOptions } from "./NodeSnapshotMedia.ts";
export { SnapshotError } from "./SnapshotContract.ts";
export type { SnapshotManifest } from "./SnapshotContract.ts";

/** Host file driver around the same engine as Expo. Never adds working database DDL. */
const engine = new SqliteSnapshotEngine({ identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
const backupObjects = SNAPSHOT_OBJECTS;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Streaming, typed logical checksum, not JSON.stringify of the entire database. Includes
 * all canonical tables, every raw row (even soft-deleted ones), SQL definitions and ledgers.
 * No locale/rowid dependency; equal rows have identical encodings, duplicates keep multiplicity.
 * Not a signature: checksums detect corruption, they do not authenticate the file's author.
 */
export function canonicalContentSha256(db: DatabaseSync, photos: readonly RestoredRecipePhoto[] = []): string {
  const relocated = new Map(photos.map((photo) => [photo.id, photo]));
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
      for (const name of columns) {
        const photo = table === "recipes" && name === "details_json" ? relocated.get(String(row.id)) : undefined;
        feed(photo ? originalPhotoJsonForParity(row[name], photo) : row[name]);
      }
    }
    hash.update("end-table;");
  }
  return hash.digest("hex");
}
async function inspectSnapshot(db: DatabaseSync): Promise<SnapshotManifest> {
  return engine.validateSnapshot(nodeSnapshotSql(db));
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
  metadata: Pick<SnapshotManifest, "backupId" | "createdAt">, mediaOptions: SnapshotMediaOptions = {}): Promise<SnapshotManifest> {
  try {
    if (canonicalPath(partial) === canonicalPath(destination)) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
    if (existsSync(destination)) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
    if (await inspectProductionDatabase(nodeSqlitePort(source)) !== "OWNED") throw new SnapshotError("SNAPSHOT_INVALID");
    reserve(partial);
    await backup(source, partial);
    const copy = new DatabaseSync(partial);
    try {
      copy.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
      await engine.sealSnapshot(nodeSnapshotSql(copy), metadata, nodeSnapshotMediaSettings(mediaOptions));
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
export async function prepareBackupForRestore(file: string, staging: string, mediaOptions: SnapshotMediaOptions = {}): Promise<SnapshotManifest> {
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
      await engine.stageSnapshot(nodeSnapshotSql(candidate), nodeSnapshotMediaSettings(mediaOptions));
    } finally { candidate.close(); }
    sync(staging);
    return manifest;
  } catch (error) { return typed(error); }
}
