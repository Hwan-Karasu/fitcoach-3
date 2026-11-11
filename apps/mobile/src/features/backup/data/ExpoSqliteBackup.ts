import { File, FileMode } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { DatabaseCompatibilityError, inspectDatabaseIdentity } from "../../../shared/db/DatabaseIdentity.ts";
import { isStorageFull } from "../domain/BackupFailure.ts";
import { observeBackup, type BackupObserver } from "../domain/BackupProgress.ts";
import { SnapshotError, type SnapshotManifest } from "../domain/SnapshotManifest.ts";
import { assertSnapshotPrivateUri } from "./ExpoSnapshotMedia.ts";
import { expoSnapshotSql } from "./ExpoSnapshotSql.ts";
import { SqliteSnapshotEngine, type SnapshotSchema } from "./SqliteSnapshotEngine.ts";
import type { SnapshotMediaSettings } from "./SnapshotMediaPort.ts";

/** Прежде DatabaseCompatibilityError (чужая/повреждённая/более новая база) попадал в SNAPSHOT_IO_FAILED и на экране выглядел как
 * «не удалось прочитать файл» (BKP-AUDIT-1 D1). Теперь причина сохраняется: newer — отдельно, остальное — невалидная копия. */
function typed(error: unknown): never {
  if (error instanceof SnapshotError) throw error;
  if (error instanceof DatabaseCompatibilityError) throw new SnapshotError(error.code === "DATABASE_NEWER" ? "SNAPSHOT_NEWER" : "SNAPSHOT_INVALID");
  throw new SnapshotError(isStorageFull(error) ? "SNAPSHOT_SPACE_LOW" : "SNAPSHOT_IO_FAILED");
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
  private async inspectPrivate(file: File, observe?: BackupObserver): Promise<SnapshotManifest> {
    noSidecars(file); header(file);
    const db = await this.open(file, true);
    try { return await this.engine.validateSnapshot(expoSnapshotSql(db), observe); }
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
      observeBackup(settings.observe, "SNAPSHOT");
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
      stage = "verify"; const manifest = await this.inspectPrivate(partial, settings.observe);
      stage = "move"; if (destination.exists) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      await moveAsync({ from: partial.uri, to: destination.uri });
      return manifest;
    } catch (error) {
      console.warn("SNAPSHOT_PREPARE_FAILED", stage, error instanceof SnapshotError ? error.code : "IO");
      return typed(error);
    }
  }
  /** BKP-PERF-1: запечатать уже снятую приватную копию на месте (journal_mode=DELETE, закрыта вызывающим) вместо второго
   * backupDatabaseAsync. `knownContentSha256` пересчитывается проверкой до переноса в `destination`. */
  async sealPrivateCopy(copy: File, destination: File, metadata: Pick<SnapshotManifest, "backupId" | "createdAt">,
    knownContentSha256: string, settings: SnapshotMediaSettings = {}): Promise<SnapshotManifest> {
    let stage = "seal";
    try {
      assertSnapshotPrivateUri(destination.uri);
      if (copy.uri === destination.uri || destination.exists) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      noSidecars(copy); header(copy);
      const db = await this.open(copy, false);
      try {
        await db.execAsync("PRAGMA synchronous=FULL");
        await this.engine.sealSnapshot(expoSnapshotSql(db), metadata, settings, knownContentSha256);
      } finally { await db.closeAsync(); }
      stage = "verify"; const manifest = await this.inspectPrivate(copy, settings.observe);
      stage = "move"; if (destination.exists) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      await moveAsync({ from: copy.uri, to: destination.uri });
      return manifest;
    } catch (error) {
      console.warn("SNAPSHOT_PREPARE_FAILED", stage, error instanceof SnapshotError ? error.code : "IO");
      return typed(error);
    }
  }
  /** privateCopy is a fresh inspection slot retained for this operation, not the external source. */
  async validateExternal(source: File, privateCopy: File, observe?: BackupObserver): Promise<SnapshotManifest> {
    try {
      if (source.uri === privateCopy.uri) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      reserve(privateCopy);
      observeBackup(observe, "SNAPSHOT");
      // Only overwrite the zero-byte placeholder just reserved by this operation.
      await source.copy(privateCopy, { overwrite: true });
      return await this.inspectPrivate(privateCopy, observe);
    } catch (error) { return typed(error); }
  }
  async prepareForRestore(source: File, privateCopy: File, staging: File,
    settings: SnapshotMediaSettings = {}, onCandidate?: () => void): Promise<SnapshotManifest> {
    try {
      if ([source.uri, privateCopy.uri].includes(staging.uri)) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      // Validate the actual candidate exactly once, before changing any table. The old
      // path fully hashed privateCopy, then immediately hashed its identical SQLite copy
      // again in stageSnapshot. No validation is skipped inside stageSnapshot.
      if (source.uri === privateCopy.uri) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
      reserve(privateCopy);
      observeBackup(settings.observe, "SNAPSHOT");
      await source.copy(privateCopy, { overwrite: true });
      noSidecars(privateCopy); header(privateCopy);
      reserve(staging);
      const from = await this.open(privateCopy, true);
      let manifest: SnapshotManifest;
      try {
        const candidate = await this.open(staging, false);
        try {
          await SQLite.backupDatabaseAsync({ sourceDatabase: from, destDatabase: candidate });
          await candidate.execAsync("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
          manifest = await this.engine.stageSnapshot(expoSnapshotSql(candidate), settings, onCandidate);
        } finally { await candidate.closeAsync(); }
      } finally { await from.closeAsync(); }
      noSidecars(staging);
      return manifest;
    } catch (error) { return typed(error); }
  }
}
