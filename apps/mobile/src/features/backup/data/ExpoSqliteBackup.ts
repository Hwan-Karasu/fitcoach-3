import { File, FileMode } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { inspectDatabaseIdentity } from "../../../shared/db/DatabaseIdentity.ts";
import { SnapshotError, type SnapshotManifest } from "../domain/SnapshotManifest.ts";
import { assertSnapshotPrivateUri } from "./ExpoSnapshotMedia.ts";
import { expoSnapshotSql } from "./ExpoSnapshotSql.ts";
import { SqliteSnapshotEngine, type SnapshotSchema } from "./SqliteSnapshotEngine.ts";
import type { SnapshotMediaSettings } from "./SnapshotMediaPort.ts";

function typed(error: unknown): never {
  if (error instanceof SnapshotError) throw error;
  throw new SnapshotError("SNAPSHOT_IO_FAILED");
}
function noSidecars(file: File): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) if (new File(`${file.uri}${suffix}`).exists) throw new SnapshotError("SNAPSHOT_INVALID");
}
function reserve(file: File): void {
  assertSnapshotPrivateUri(file.uri);
  if (file.exists) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
  noSidecars(file); file.create();
}
function header(file: File): void {
  if (!file.exists || file.size < 100) throw new SnapshotError("SNAPSHOT_INVALID");
  const reader = file.open(FileMode.ReadOnly);
  try {
    const bytes = reader.readBytes(16);
    const magic = [83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0];
    if (bytes.length !== 16 || magic.some((byte, index) => bytes[index] !== byte)) throw new SnapshotError("SNAPSHOT_INVALID");
  } finally { reader.close(); }
}
/** Native file driver for the common format. Each call must be serialized by its caller.
 * All writable paths are fresh private files; sources may be picker/SAF files and are never
 * opened by SQLite directly (Expo has no readonly open flag). No rotation/SAF publication here. */
export class ExpoSqliteBackup {
  private readonly schema: SnapshotSchema;
  private readonly engine: SqliteSnapshotEngine;
  constructor(schema: SnapshotSchema) { this.schema = schema; this.engine = new SqliteSnapshotEngine(schema); }
  private async open(file: File, readOnly: boolean): Promise<SQLite.SQLiteDatabase> {
    assertSnapshotPrivateUri(file.uri);
    const db = await SQLite.openDatabaseAsync(file.name, { useNewConnection: true }, file.parentDirectory.uri);
    try {
      await db.execAsync(readOnly ? "PRAGMA query_only=ON; PRAGMA foreign_keys=ON" : "PRAGMA foreign_keys=ON");
      return db;
    } catch (error) { await db.closeAsync(); throw error; }
  }
  private async inspectPrivate(file: File): Promise<SnapshotManifest> {
    noSidecars(file); header(file);
    const db = await this.open(file, true);
    try { return await this.engine.validateSnapshot(expoSnapshotSql(db)); }
    finally { await db.closeAsync(); }
  }
  /** Verification of an already sealed private point; never opens the old photo URIs. */
  async validatePrivateSnapshot(file: File): Promise<SnapshotManifest> {
    try { assertSnapshotPrivateUri(file.uri); return await this.inspectPrivate(file); }
    catch (error) { return typed(error); }
  }
  async createSnapshot(source: SQLite.SQLiteDatabase, partial: File, destination: File,
    metadata: Pick<SnapshotManifest, "backupId" | "createdAt">, settings: SnapshotMediaSettings = {}): Promise<SnapshotManifest> {
    let stage = "identity";
    try {
      assertSnapshotPrivateUri(destination.uri);
      if (partial.uri === destination.uri || destination.exists) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      if (await inspectDatabaseIdentity(expoSnapshotSql(source), this.schema.identity, this.schema.owners) !== "OWNED") throw new SnapshotError("SNAPSHOT_INVALID");
      stage = "reserve"; reserve(partial);
      const copy = await this.open(partial, false);
      try {
        stage = "copy"; await SQLite.backupDatabaseAsync({ sourceDatabase: source, destDatabase: copy });
        await copy.execAsync("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
        stage = "seal"; await this.engine.sealSnapshot(expoSnapshotSql(copy), metadata, settings);
      } finally { await copy.closeAsync(); }
      stage = "verify"; const manifest = await this.inspectPrivate(partial);
      if (destination.exists) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      await moveAsync({ from: partial.uri, to: destination.uri });
      return manifest;
    } catch (error) {
      console.warn("SNAPSHOT_PREPARE_FAILED", stage, error instanceof SnapshotError ? error.code : "IO");
      return typed(error);
    }
  }
  /** privateCopy is a fresh inspection slot retained for this operation, not the external source. */
  async validateExternal(source: File, privateCopy: File): Promise<SnapshotManifest> {
    try {
      if (source.uri === privateCopy.uri) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      reserve(privateCopy);
      // Only overwrite the zero-byte placeholder just reserved by this operation.
      await source.copy(privateCopy, { overwrite: true });
      return await this.inspectPrivate(privateCopy);
    } catch (error) { return typed(error); }
  }
  async prepareForRestore(source: File, privateCopy: File, staging: File,
    settings: SnapshotMediaSettings = {}): Promise<SnapshotManifest> {
    try {
      if ([source.uri, privateCopy.uri].includes(staging.uri)) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      const manifest = await this.validateExternal(source, privateCopy);
      reserve(staging);
      const from = await this.open(privateCopy, true);
      try {
        const candidate = await this.open(staging, false);
        try {
          await SQLite.backupDatabaseAsync({ sourceDatabase: from, destDatabase: candidate });
          await candidate.execAsync("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
          const copied = await this.engine.stageSnapshot(expoSnapshotSql(candidate), settings);
          if (JSON.stringify(copied) !== JSON.stringify(manifest)) throw new SnapshotError("SNAPSHOT_INVALID");
        } finally { await candidate.closeAsync(); }
      } finally { await from.closeAsync(); }
      noSidecars(staging);
      return manifest;
    } catch (error) { return typed(error); }
  }
}
