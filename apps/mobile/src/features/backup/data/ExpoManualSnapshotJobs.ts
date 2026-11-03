import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { uuid } from "expo-modules-core";
import { expoFileSha256 } from "../../../shared/files/ExpoFileSha256.ts";
import type { PrepareStage } from "../domain/BackupFailure.ts";
import { observeBackup, type BackupObserver } from "../domain/BackupProgress.ts";
import { manualPrepareError } from "../domain/ManualBackupPort.ts";
import type { VerifiedBackupFile } from "../domain/BackupPublication.ts";
import { ExpoSqliteBackup } from "./ExpoSqliteBackup.ts";
import { expoSnapshotMedia } from "./ExpoSnapshotMedia.ts";
import type { SnapshotSchema } from "./SqliteSnapshotEngine.ts";

/** Privileged online-backup reader, held for the whole admitted operation. Ordinary writes
 * continue; SQLite backup API produces the consistent copy. Restore waits for this reader
 * through RuntimeCommandGate. Missing/changing photos fail sealing, never publish a partial copy. */
export function expoManualSnapshotJobs(live: File, schema: SnapshotSchema) {
  const owned = new Map<string, Directory>();
  const driver = new ExpoSqliteBackup(schema);
  return {
    async prepare(observe?: BackupObserver): Promise<VerifiedBackupFile> {
      const job = new Directory(Paths.document, "backup-jobs", "production", uuid.v4());
      let created = false; let handedOff = false; let stage: PrepareStage = "source";
      try {
        if (!live.exists || live.size < 100) throw new Error("LIVE_MISSING"); // Never create a missing LIVE by opening SQLite.
        // Копия + журнал запечатывания + запас; реальная нехватка места распознаётся и по ошибке SQLite/ОС (BKP-DIAG-1).
        stage = "space"; const wal = new File(`${live.uri}-wal`);
        if (Paths.availableDiskSpace < (live.size + (wal.exists ? wal.size : 0)) * 2 + 4 * 1024 * 1024) throw new Error("SPACE_LOW");
        stage = "job"; job.create({ intermediates: true }); created = true;
        const snapshot = new File(job, "snapshot.atbackup");
        stage = "source"; const source = await SQLite.openDatabaseAsync(live.name, { useNewConnection: true }, live.parentDirectory.uri);
        const metadata = { backupId: uuid.v4(), createdAt: new Date().toISOString() };
        try {
          // Ожидание блокировки вместо мгновенного SQLITE_BUSY: expo-sqlite не проверяет итог backup_step (BKP-BUSY-1).
          await source.execAsync("PRAGMA busy_timeout=5000; PRAGMA query_only=ON; PRAGMA foreign_keys=ON");
          stage = "copy";
          await driver.createSnapshot(source, new File(job, "snapshot.partial"), snapshot, metadata,
            { files: expoSnapshotMedia(new Directory(Paths.document, "local-images")), observe: (progress) => {
              stage = progress.stage === "VERIFY" ? "verify" : progress.stage === "SNAPSHOT" ? "copy" : "seal";
              observeBackup(observe, progress.stage, progress.done, progress.total);
            } });
        } finally { await source.closeAsync(); }
        stage = "digest"; const digest = await expoFileSha256(snapshot);
        const result = { sourceUri: snapshot.uri, ...metadata, ...digest };
        owned.set(result.sourceUri, job); handedOff = true; return result;
      } catch (error) {
        const failure = manualPrepareError(stage, error);
        console.warn("MANUAL_SNAPSHOT_PREPARE_FAILED", stage, failure.code, error instanceof Error ? error.name : "UNKNOWN");
        throw failure;
      } finally {
        if (created && !handedOff) try { job.delete(); } catch { /* Private orphan, never a completed external file. */ }
      }
    },
    async cleanup(snapshot: VerifiedBackupFile): Promise<void> {
      const job = owned.get(snapshot.sourceUri);
      if (job === undefined) throw new Error("BACKUP_JOB_NOT_OWNED");
      owned.delete(snapshot.sourceUri); job.delete();
    },
  };
}
