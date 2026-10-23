import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { uuid } from "expo-modules-core";
import { expoFileSha256 } from "../../../shared/files/ExpoFileSha256.ts";
import { ManualBackupError } from "../domain/ManualBackupPort.ts";
import { SnapshotError } from "../domain/SnapshotManifest.ts";
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
    async prepare(): Promise<VerifiedBackupFile> {
      const job = new Directory(Paths.document, "backup-jobs", "production", uuid.v4());
      let created = false; let handedOff = false;
      try {
        if (!live.exists || live.size < 100) throw new Error(); // Never create a missing LIVE by opening SQLite.
        job.create({ intermediates: true }); created = true;
        const snapshot = new File(job, "snapshot.atbackup");
        const source = await SQLite.openDatabaseAsync(live.name, { useNewConnection: true }, live.parentDirectory.uri);
        const metadata = { backupId: uuid.v4(), createdAt: new Date().toISOString() };
        try {
          await source.execAsync("PRAGMA query_only=ON; PRAGMA foreign_keys=ON");
          await driver.createSnapshot(source, new File(job, "snapshot.partial"), snapshot, metadata,
            { files: expoSnapshotMedia(new Directory(Paths.document, "local-images")) });
        } finally { await source.closeAsync(); }
        const digest = await expoFileSha256(snapshot);
        const result = { sourceUri: snapshot.uri, ...metadata, ...digest };
        owned.set(result.sourceUri, job); handedOff = true; return result;
      } catch (error) {
        throw new ManualBackupError(error instanceof SnapshotError && error.code === "SNAPSHOT_INCOMPLETE_MEDIA"
          ? "BACKUP_MEDIA_UNAVAILABLE" : "BACKUP_SOURCE_UNAVAILABLE");
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
