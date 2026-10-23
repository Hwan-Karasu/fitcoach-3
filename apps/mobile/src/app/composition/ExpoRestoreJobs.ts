import { Directory, File, Paths } from "expo-file-system";
import { uuid } from "expo-modules-core";
import * as SQLite from "expo-sqlite";
import { RestoreActionError, ReturnPointCompletion, SnapshotError, emptyReturnPointState,
  parseRestoreGuard, parseReturnPointState, restoreSpaceRequired, type RestoreJobsPort, type RestorePreview,
  type ReturnPoint } from "../../features/backup/public.ts";
import { ExpoRestoreStorage } from "../../features/backup/data/ExpoRestoreStorage.ts";
import { ExpoReturnPointStore } from "../../features/backup/data/ExpoReturnPointStore.ts";
import { ExpoSqliteBackup } from "../../features/backup/data/ExpoSqliteBackup.ts";
import { assertSnapshotPrivateUri, expoSnapshotMedia } from "../../features/backup/data/ExpoSnapshotMedia.ts";
import { expoSnapshotSql } from "../../features/backup/data/ExpoSnapshotSql.ts";
import { snapshotContentSha256 } from "../../features/backup/data/SnapshotContentHash.ts";
import { recipePhotoReferences } from "../../features/backup/data/SnapshotMedia.ts";
import { expoFileSha256 } from "../../shared/files/ExpoFileSha256.ts";
import { parsePendingRuntimeRestore } from "../bootstrap/recoverRuntimeRestore.ts";
import { applyPreparedRestore, type PreparedRestoreIdentity } from "../runtime/ApplyPreparedRestore.ts";
import type { RuntimeMaintenance } from "../runtime/RuntimeMaintenance.ts";
import { ExpoRuntimeRestoreJournal } from "./ExpoRuntimeRestoreJournal.ts";
import { inspectProductionDatabase, PRODUCTION_IDENTITY } from "./productionDatabase.ts";
import { recoverLocalRestore } from "./recoverProductionRestore.ts";
import { SCHEMA_OWNERS } from "./schema.ts";

interface Options {
  readonly root: Directory;
  readonly live: File;
  readonly images: Directory;
  readonly maintenance: Pick<RuntimeMaintenance, "withClosedDatabase">;
  /** Test composition may select its own synthetic file; product composition uses the system picker. */
  readonly pick?: () => Promise<File | null>;
}
interface Prepared extends PreparedRestoreIdentity {
  readonly preview: RestorePreview;
  readonly pointId: string | null;
}
const schema = { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS };
const ownedId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const marker = (id: string) => JSON.stringify({ kind: "athlete-restore-job", version: 1, operationId: id });
const space = (required: number) => {
  const available = Paths.availableDiskSpace;
  if (!Number.isSafeInteger(required) || required < 0 || !Number.isFinite(available) || available < required) throw new RestoreActionError("RESTORE_NO_SPACE");
};
function masked(error: unknown): RestoreActionError {
  if (error instanceof RestoreActionError) return error;
  if (error instanceof SnapshotError && error.code !== "SNAPSHOT_IO_FAILED") return new RestoreActionError("RESTORE_INVALID_BACKUP");
  return new RestoreActionError("RESTORE_SOURCE_UNAVAILABLE");
}

/** Privileged file/SQLite orchestration. UI receives only opaque IDs and verified summaries.
 * Each preparation has fresh private slots. Imported paths never choose a job, LIVE or output.
 * read methods are admitted by RestoreActionsService; apply/delete/recover own maintenance. */
export class ExpoRestoreJobs implements RestoreJobsPort {
  private readonly options: Options;
  private readonly prepared = new Map<string, Prepared>();
  private readonly driver = new ExpoSqliteBackup(schema);
  private readonly points: ExpoReturnPointStore;
  private readonly journal: ExpoRuntimeRestoreJournal;
  constructor(options: Options) {
    for (const item of [options.root, options.live, options.images]) assertSnapshotPrivateUri(item.uri);
    this.options = options; this.points = new ExpoReturnPointStore(options.root, schema); this.journal = new ExpoRuntimeRestoreJournal(options.root);
  }
  private job(id: string): Directory {
    if (!ownedId.test(id)) throw new RestoreActionError("RESTORE_STALE_PREVIEW");
    return new Directory(this.options.root, "jobs", id);
  }
  private async read<T>(file: File, task: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
    if (!file.exists || file.size < 100) throw new RestoreActionError("RESTORE_SOURCE_UNAVAILABLE");
    const db = await SQLite.openDatabaseAsync(file.name, { useNewConnection: true }, file.parentDirectory.uri);
    try {
      await db.execAsync("PRAGMA query_only=ON; PRAGMA foreign_keys=ON");
      if (await inspectProductionDatabase(expoSnapshotSql(db)) !== "OWNED") throw new RestoreActionError("RESTORE_SOURCE_UNAVAILABLE");
      return await task(db);
    } finally { await db.closeAsync(); }
  }
  private async state() {
    const saved = await this.points.readState(); return saved === null ? emptyReturnPointState() : parseReturnPointState(saved);
  }
  private async point(): Promise<ReturnPoint | null> {
    try {
      const point = (await this.state()).point;
      if (point !== null) await this.points.verifyPoint(point);
      return point;
    } catch { throw new RestoreActionError("RESTORE_POINT_UNAVAILABLE"); }
  }
  async readPoint() {
    const point = await this.point(); return point === null ? null : { id: point.operationId, createdAt: point.createdAt };
  }
  private async currentPin(directory: Directory): Promise<string> {
    const copy = new File(directory, "current-preview.db");
    space(this.options.live.size + 4 * 1024 * 1024);
    copy.create();
    await this.read(this.options.live, async (source) => {
      const destination = await SQLite.openDatabaseAsync(copy.name, { useNewConnection: true }, directory.uri);
      try {
        await SQLite.backupDatabaseAsync({ sourceDatabase: source, destDatabase: destination });
        await destination.execAsync("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON");
      } finally { await destination.closeAsync(); }
    });
    return this.read(copy, (db) => snapshotContentSha256(expoSnapshotSql(db)));
  }
  private async prepare(source: File, kind: RestorePreview["kind"], pointId: string | null): Promise<RestorePreview> {
    const id = uuid.v4(); const directory = this.job(id); let created = false;
    try {
      await this.cleanupOrphans();
      // Peak includes private inspection, staging with BLOB media and extracted images.
      space(3 * source.size + this.options.live.size + 4 * 1024 * 1024);
      directory.create({ intermediates: true }); created = true;
      new File(directory, "owner.json").write(marker(id));
      const incoming = new File(directory, "incoming.db");
      const manifest = await this.driver.prepareForRestore(source, new File(directory, "inspection.atbackup"), incoming,
        { files: expoSnapshotMedia(this.options.images), restoreId: id });
      const counts = await this.read(incoming, async (db) => {
        const rows = await db.getAllAsync<{ lifecycle: string; count: number }>("SELECT lifecycle, count(*) AS count FROM clients GROUP BY lifecycle");
        return { activeClients: rows.find((row) => row.lifecycle === "ACTIVE")?.count ?? 0, archivedClients: rows.find((row) => row.lifecycle === "ARCHIVED")?.count ?? 0 };
      });
      const currentContentSha256 = await this.currentPin(directory);
      const incomingSha256 = (await expoFileSha256(incoming)).sha256;
      const preview: RestorePreview = Object.freeze({ id, kind, createdAt: manifest.createdAt, ...counts });
      this.prepared.set(id, { id, preview, pointId, currentContentSha256, incomingSha256 });
      return preview;
    } catch (error) {
      if (created) try { await this.cleanup(id); } catch { /* Own unpublished orphan is retryable. */ }
      throw masked(error);
    }
  }
  async prepareFile(): Promise<RestorePreview | null> {
    try {
      const file = this.options.pick ? await this.options.pick() : await (async () => {
        const result = await File.pickFileAsync({}); return result.canceled ? null : result.result;
      })();
      return file === null ? null : this.prepare(file, "RESTORE", null);
    } catch (error) { throw masked(error); }
  }
  async prepareReturn(pointId: string): Promise<RestorePreview> {
    const point = await this.point();
    if (point === null || point.operationId !== pointId) throw new RestoreActionError("RESTORE_POINT_UNAVAILABLE");
    return this.prepare(this.points.pointFile(point), "RETURN", pointId);
  }
  private async checkSpace(kind: RestorePreview["kind"]): Promise<void> {
    if (kind === "RETURN") { space(restoreSpaceRequired(this.options.live.size, 0, 0, kind)); return; }
    const uris = await this.read(this.options.live, async (db) => [...new Set((await recipePhotoReferences(expoSnapshotSql(db))).map((row) => row.sourceUri))]);
    let bytes = 0;
    for (const uri of uris) {
      // Validate the exact configured source directory as createPoint does, without opening a foreign URI.
      const reader = await expoSnapshotMedia(this.options.images).openSource(uri);
      try { bytes += reader.size; } finally { reader.close(); }
    }
    space(restoreSpaceRequired(this.options.live.size, bytes, uris.length, kind));
  }
  async apply(id: string): Promise<"COMMITTED" | "ROLLED_BACK"> {
    const job = this.prepared.get(id);
    if (!job) throw new RestoreActionError("RESTORE_STALE_PREVIEW");
    const { live, root, images, maintenance } = this.options;
    const storage = new ExpoRestoreStorage({ live, directory: this.job(id), inspectDatabase: inspectProductionDatabase,
      withClosedDatabase: (task) => maintenance.withClosedDatabase(async () => {
        const result = await task();
        try { await this.collectUnusedRestoreImages(id); } catch { /* Cleanup never changes a verified outcome. */ }
        return result;
      }) });
    const completion = new ReturnPointCompletion(this.points, job.preview.kind === "RESTORE"
      ? { kind: "RESTORE", createPoint: (plan) => this.points.createPoint(plan, live, images) }
      : { kind: "RETURN", expectedPointOperationId: job.pointId! });
    return applyPreparedRestore(job, { storage, journal: this.journal, completion,
      currentContentSha256: () => this.read(live, (db) => snapshotContentSha256(expoSnapshotSql(db))),
      checkSpace: () => this.checkSpace(job.preview.kind),
      recoverPublished: () => recoverLocalRestore({ withClosedDatabase: async (task) => task() }, root, live),
    });
  }
  async deletePoint(id: string): Promise<void> {
    let failure: RestoreActionError | null = null;
    try {
      await this.options.maintenance.withClosedDatabase(async () => {
        const state = await this.state();
        if (state.point?.operationId !== id) { failure = new RestoreActionError("RESTORE_STALE_PREVIEW"); return; }
        await new ReturnPointCompletion(this.points).deletePoint(id);
      });
    } catch { throw new RestoreActionError("RESTORE_RECOVERY_REQUIRED"); }
    if (failure !== null) throw failure;
  }
  async recover(): ReturnType<RestoreJobsPort["recover"]> {
    try {
      return await this.options.maintenance.withClosedDatabase(async () => {
        await recoverLocalRestore({ withClosedDatabase: async (task) => task() }, this.options.root, this.options.live);
        const pending = await this.journal.readPending(); if (pending === null) return;
        const plan = parsePendingRuntimeRestore(pending.value); const guard = parseRestoreGuard(await this.journal.readGuard(plan.operationId));
        if (guard.operationId !== plan.operationId || guard.currentSha256 !== plan.currentSha256 || guard.incomingSha256 !== plan.incomingSha256 ||
          (guard.phase !== "COMPLETED" && guard.phase !== "ROLLED_BACK")) throw new RestoreActionError("RESTORE_RECOVERY_REQUIRED");
        return { id: plan.operationId, outcome: guard.phase === "COMPLETED" ? "COMMITTED" as const : "ROLLED_BACK" as const };
      });
    } catch { throw new RestoreActionError("RESTORE_RECOVERY_REQUIRED"); }
  }
  async discard(id: string): Promise<void> { this.prepared.delete(id); await this.cleanup(id); }
  private async cleanup(id: string): Promise<void> {
    const directory = this.job(id); const owner = new File(directory, "owner.json");
    if (!owner.exists || owner.size > 200 || await owner.text() !== marker(id)) return;
    const pending = await this.journal.readPending(); const plan = pending === null ? null : parsePendingRuntimeRestore(pending.value);
    const state = await this.state(); const raw = await this.journal.readGuard(id); const guard = raw === null ? null : parseRestoreGuard(raw);
    if (guard !== null && (guard.operationId !== id || (guard.phase !== "COMPLETED" && guard.phase !== "ROLLED_BACK"))) return;
    if (state.point?.operationId === id && guard === null) return;
    if (plan?.operationId === id && (guard === null || state.settledOperationId !== id)) return;
    if (plan?.operationId === id && (guard!.currentSha256 !== plan.currentSha256 || guard!.incomingSha256 !== plan.incomingSha256)) return;
    // Only never-published/rolled-back job media can be removed without reading current recipes.
    // Successful media GC runs under a closed lease; pending/active point metadata survives cleanup.
    if (guard === null || guard.phase === "ROLLED_BACK") this.removeUnpublishedImages(id);
    if (plan?.operationId !== id && state.point?.operationId !== id) { directory.delete(); return; }
    for (const name of ["inspection.atbackup", "current-preview.db", "incoming.db", "safety.db", "previous.db", "rejected.db", "rollback.db"]) {
      const file = new File(directory, name); if (file.exists) file.delete();
    }
  }
  private removeUnpublishedImages(id: string): void {
    if (!this.options.images.exists) return;
    const filename = new RegExp(`^restore-${id}-[a-f0-9]{64}\\.(?:png|jpg|webp|heic)(?:\\.[a-f0-9-]{36}\\.partial)?$`, "u");
    for (const file of this.options.images.list()) if (file instanceof File && filename.test(file.name)) file.delete();
  }
  /** Run only with the runtime physically closed and old screens/drafts retired. Ordinary
   * concurrent reads cannot authorize GC: a queued recipe save could still reference a file.
   * Active points embed their own media; verify that fact before removing former images. */
  private async collectUnusedRestoreImages(currentId: string): Promise<void> {
    if (!this.options.images.exists) return;
    const point = (await this.state()).point;
    if (point !== null) await this.points.verifyPoint(point);
    const required = new Set(await this.read(this.options.live, async (db) => (await recipePhotoReferences(expoSnapshotSql(db))).map((row) => row.sourceUri)));
    const raw = await this.journal.readGuard(currentId); const guard = raw === null ? null : parseRestoreGuard(raw);
    if (guard !== null && guard.operationId !== currentId) return;
    const terminal = guard?.phase === "COMPLETED" || guard?.phase === "ROLLED_BACK";
    const protectedJobs = new Set([...this.prepared.keys()].filter((id) => id !== currentId || !terminal));
    for (const file of this.options.images.list()) {
      const match = /^restore-([a-f0-9-]{36})-[a-f0-9]{64}\.(?:png|jpg|webp|heic)(?:\.([a-f0-9-]{36})\.partial)?$/u.exec(file.name);
      if (!(file instanceof File) || !match || !ownedId.test(match[1]!) || (match[2] !== undefined && !ownedId.test(match[2])) ||
        protectedJobs.has(match[1]!) || required.has(file.uri)) continue;
      file.delete();
    }
  }
  /** Unknown directories and uncertain metadata are preserved for recovery, never guessed. */
  private async cleanupOrphans(): Promise<void> {
    const jobs = new Directory(this.options.root, "jobs"); if (!jobs.exists) return;
    for (const directory of jobs.list()) if (directory instanceof Directory && ownedId.test(directory.name) && !this.prepared.has(directory.name)) {
      try { await this.cleanup(directory.name); } catch { /* Preserve evidence and retry later. */ }
    }
  }
}
