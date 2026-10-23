import { Directory, File, Paths } from "expo-file-system";
import { uuid, requireOptionalNativeModule } from "expo-modules-core";
import * as SQLite from "expo-sqlite";
import { inspectDatabaseIdentity } from "../../../shared/db/DatabaseIdentity.ts";
import { expoFileSha256 } from "../../../shared/files/ExpoFileSha256.ts";
import { AutomaticBackupError, parseAutomaticPublication, type AutomaticBackupFiles, type AutomaticEntry,
  type PendingAutomatic } from "../domain/AutomaticBackup.ts";
import { publicationTreeUri, type BackupDestination } from "../domain/BackupPublication.ts";
import { assertSnapshotPrivateUri, expoSnapshotMedia } from "./ExpoSnapshotMedia.ts";
import { ExpoSqliteBackup } from "./ExpoSqliteBackup.ts";
import { expoSnapshotSql } from "./ExpoSnapshotSql.ts";
import { snapshotContentSha256 } from "./SnapshotContentHash.ts";
import type { SnapshotSchema } from "./SqliteSnapshotEngine.ts";

interface NativeAutomatic {
  automaticProtocolVersion?(): number;
  publishAutomatic(source: string, id: string, createdAt: string, sha256: string, bytes: number, tree: string | null): Promise<unknown>;
  verifyAutomatic(id: string, uri: string, sha256: string, bytes: number): Promise<boolean>;
  removeAutomatic(id: string, uri: string, sha256: string, bytes: number): Promise<boolean>;
}
const ownedId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const owner = (id: string) => JSON.stringify({ kind: "athlete-auto-job", version: 1, id });
export function nativeAutomaticBackupAvailable(): boolean {
  try { return requireOptionalNativeModule<NativeAutomatic>("AthleteBackupStorage")?.automaticProtocolVersion?.() === 1; }
  catch { return false; }
}
interface Options {
  readonly root: Directory;
  readonly live: File;
  readonly images: Directory;
  readonly schema: SnapshotSchema;
  readonly pendingIds: () => Promise<readonly string[]>;
  readonly now?: () => number;
}
/** Stable private online copy is hashed BEFORE media embedding. Unchanged data does not
 * create a new snapshot/publication. Every SQLite handle belongs to one admitted check. */
export class ExpoAutomaticBackupFiles implements AutomaticBackupFiles {
  private readonly options: Options;
  private readonly native = requireOptionalNativeModule<NativeAutomatic>("AthleteBackupStorage");
  private readonly driver: ExpoSqliteBackup;
  readonly available: boolean;
  constructor(options: Options) {
    this.options = options; this.driver = new ExpoSqliteBackup(options.schema);
    for (const path of [options.root, options.live, options.images]) assertSnapshotPrivateUri(path.uri);
    try { this.available = this.native?.automaticProtocolVersion?.() === 1; } catch { this.available = false; }
  }
  private job(id: string): Directory {
    if (!ownedId.test(id)) throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE");
    return new Directory(this.options.root, "automatic-jobs", id);
  }
  async prepare(previousContentSha256: string | null): Promise<PendingAutomatic | null> {
    await this.cleanOrphans(); const id = uuid.v4(); const job = this.job(id); let created = false; let handedOff = false;
    try {
      const { live, schema, images } = this.options;
      if (!live.exists || live.size < 100 || Paths.availableDiskSpace < live.size * 3 + 4 * 1024 * 1024) throw new Error();
      job.create({ intermediates: true }); created = true; new File(job, "owner.json").write(owner(id));
      const current = new File(job, "current.db"); current.create();
      const source = await SQLite.openDatabaseAsync(live.name, { useNewConnection: true }, live.parentDirectory.uri);
      let contentSha256: string;
      try {
        await source.execAsync("PRAGMA query_only=ON; PRAGMA foreign_keys=ON");
        const copy = await SQLite.openDatabaseAsync(current.name, { useNewConnection: true }, job.uri);
        try {
          await SQLite.backupDatabaseAsync({ sourceDatabase: source, destDatabase: copy });
          await copy.execAsync("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON");
          if (await inspectDatabaseIdentity(expoSnapshotSql(copy), schema.identity, schema.owners) !== "OWNED") throw new Error();
          contentSha256 = await snapshotContentSha256(expoSnapshotSql(copy));
        } finally { await copy.closeAsync(); }
      } finally { await source.closeAsync(); }
      if (contentSha256 === previousContentSha256) return null;
      const from = await SQLite.openDatabaseAsync(current.name, { useNewConnection: true }, job.uri);
      const createdAt = new Date(this.options.now?.() ?? Date.now()).toISOString(); const snapshot = new File(job, "snapshot.atbackup");
      try {
        await from.execAsync("PRAGMA query_only=ON; PRAGMA foreign_keys=ON");
        const manifest = await this.driver.createSnapshot(from, new File(job, "snapshot.partial"), snapshot,
          { backupId: id, createdAt }, { files: expoSnapshotMedia(images) });
        if (manifest.contentSha256 !== contentSha256) throw new Error();
      } finally { await from.closeAsync(); }
      const result = { backupId: id, createdAt, contentSha256, ...await expoFileSha256(snapshot) };
      handedOff = true; return result;
    } catch { throw new AutomaticBackupError("AUTO_SOURCE_UNAVAILABLE"); }
    finally { if (created && !handedOff) try { await this.cleanup(id); } catch { /* Retryable own orphan. */ } }
  }
  async publish(pending: PendingAutomatic, destination: BackupDestination) {
    if (!this.available || this.native === null) throw new AutomaticBackupError("AUTO_UNAVAILABLE");
    const file = new File(this.job(pending.backupId), "snapshot.atbackup");
    try {
      if (file.exists) {
        const digest = await expoFileSha256(file); const manifest = await this.driver.validatePrivateSnapshot(file);
        if (digest.sha256 !== pending.sha256 || digest.bytes !== pending.bytes || manifest.backupId !== pending.backupId ||
          manifest.createdAt !== pending.createdAt || manifest.contentSha256 !== pending.contentSha256) throw new AutomaticBackupError("AUTO_VERIFICATION_FAILED");
      }
      // A durable native receipt can finish replay even if the private source was lost;
      // without that receipt, the native publisher requires the exact existing source.
      const raw = await this.native.publishAutomatic(file.uri, pending.backupId, pending.createdAt, pending.sha256, pending.bytes, publicationTreeUri(destination));
      if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true) throw new AutomaticBackupError("AUTO_FOLDER_UNAVAILABLE");
      if (Object.keys(raw).sort().join(",") !== "bytes,filename,ok,sha256,uri") throw new AutomaticBackupError("AUTO_VERIFICATION_FAILED");
      const receipt = raw as Record<string, unknown>;
      try { return parseAutomaticPublication({ uri: receipt.uri, filename: receipt.filename, bytes: receipt.bytes, sha256: receipt.sha256 }, pending); }
      catch { throw new AutomaticBackupError("AUTO_VERIFICATION_FAILED"); }
    } catch (error) { throw error instanceof AutomaticBackupError ? error : new AutomaticBackupError("AUTO_FOLDER_UNAVAILABLE"); }
  }
  async verify(entry: AutomaticEntry): Promise<void> {
    try {
      if (await this.native?.verifyAutomatic(entry.backupId, entry.uri, entry.sha256, entry.bytes) === true) return;
    } catch { /* Mask platform messages/paths. */ }
    throw new AutomaticBackupError("AUTO_VERIFICATION_FAILED");
  }
  async remove(entry: AutomaticEntry): Promise<void> {
    try { if (await this.native?.removeAutomatic(entry.backupId, entry.uri, entry.sha256, entry.bytes) === true) return; }
    catch { /* Exact native ownership proof is mandatory, never use File.delete fallback. */ }
    throw new AutomaticBackupError("AUTO_CLEANUP_PENDING");
  }
  async cleanup(id: string): Promise<void> {
    const job = this.job(id); const marker = new File(job, "owner.json");
    if (marker.exists && marker.size < 200 && await marker.text() === owner(id)) job.delete();
  }
  private async cleanOrphans(): Promise<void> {
    const root = new Directory(this.options.root, "automatic-jobs"); if (!root.exists) return;
    const pending = new Set(await this.options.pendingIds());
    for (const job of root.list()) if (job instanceof Directory && ownedId.test(job.name) && !pending.has(job.name)) {
      try { await this.cleanup(job.name); } catch { /* Unknown/corrupt jobs are never recursively removed. */ }
    }
  }
}
