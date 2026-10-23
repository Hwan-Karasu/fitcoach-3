import { Directory, File } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import { uuid } from "expo-modules-core";
import * as SQLite from "expo-sqlite";
import { expoFileSha256 } from "../../../shared/files/ExpoFileSha256.ts";
import { RestoreProtocolError } from "../domain/RestoreProtocolError.ts";
import { completionPlan, parseRestoreCompletionIntent, parseReturnPoint, parseReturnPointState,
  type RestoreCompletionIntent, type ReturnPoint, type ReturnPointState, type ReturnPointStore } from "../domain/RestoreCompletion.ts";
import type { RestorePlan } from "../domain/RestoreStorage.ts";
import { assertSnapshotPrivateUri, expoSnapshotMedia } from "./ExpoSnapshotMedia.ts";
import { ExpoSqliteBackup } from "./ExpoSqliteBackup.ts";
import type { SnapshotSchema } from "./SqliteSnapshotEngine.ts";

/** Private per-workspace root supplied by composition, outside SQLite and auto rotation.
 * JSON rename is atomic against process death; no power-loss directory fsync is claimed. */
export class ExpoReturnPointStore implements ReturnPointStore {
  private readonly root: Directory;
  private readonly driver: ExpoSqliteBackup;
  constructor(root: Directory, schema: SnapshotSchema) {
    assertSnapshotPrivateUri(root.uri); this.root = root; this.driver = new ExpoSqliteBackup(schema);
  }
  private job(operationId: string): Directory {
    // Reuse the strict UUID/hash validator before deriving any path.
    completionPlan({ operationId, currentSha256: "0".repeat(64), incomingSha256: "0".repeat(64) });
    return new Directory(this.root, "jobs", operationId);
  }
  pointFile(point: ReturnPoint): File { return new File(this.job(parseReturnPoint(point).operationId), "return.atbackup"); }
  private async read(file: File): Promise<unknown | null> {
    if (!file.exists) return null;
    if (file.size > 32768) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    const value: unknown = JSON.parse(await file.text());
    if (value === null) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    return value;
  }
  private async write(file: File, value: unknown, exclusive: boolean): Promise<void> {
    if (exclusive && file.exists) throw new RestoreProtocolError("RESTORE_BUSY");
    const next = new File(file.parentDirectory, `${file.name}-${uuid.v4()}.next`); let created = false;
    try {
      next.create(); created = true; next.write(JSON.stringify(value));
      if (JSON.stringify(JSON.parse(await next.text())) !== JSON.stringify(value)) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
      if (exclusive && file.exists) throw new RestoreProtocolError("RESTORE_BUSY");
      await moveAsync({ from: next.uri, to: file.uri });
    } finally { if (created && next.exists) next.delete(); }
  }
  readState(): Promise<unknown | null> { return this.read(new File(this.root, "return-state.json")); }
  writeState(state: ReturnPointState): Promise<void> { return this.write(new File(this.root, "return-state.json"), parseReturnPointState(state), false); }
  readIntent(operationId: string): Promise<unknown | null> { return this.read(new File(this.job(operationId), "completion.json")); }
  writeIntent(input: RestoreCompletionIntent): Promise<void> {
    const intent = parseRestoreCompletionIntent(input);
    if (!this.job(intent.operationId).exists) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    return this.write(new File(this.job(intent.operationId), "completion.json"), intent, true);
  }
  async verifyPoint(input: ReturnPoint): Promise<void> {
    const point = parseReturnPoint(input); const file = this.pointFile(point);
    const before = await expoFileSha256(file);
    if (before.bytes !== point.bytes || before.sha256 !== point.sha256) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    const manifest = await this.driver.validatePrivateSnapshot(file);
    const after = await expoFileSha256(file);
    if (after.bytes !== point.bytes || after.sha256 !== point.sha256 || manifest.backupId !== point.backupId ||
      manifest.createdAt !== point.createdAt || manifest.contentSha256 !== point.contentSha256) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
  }
  async removePoint(input: ReturnPoint): Promise<void> {
    const point = parseReturnPoint(input); const file = this.pointFile(point);
    if (!file.exists) return;
    const digest = await expoFileSha256(file);
    if (digest.bytes !== point.bytes || digest.sha256 !== point.sha256) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    file.delete();
  }
  /** Called under the closed runtime lease before pending.json and before any file swap. */
  async createPoint(input: RestorePlan, live: File, images: Directory): Promise<ReturnPoint> {
    const plan = completionPlan(input); assertSnapshotPrivateUri(live.uri); assertSnapshotPrivateUri(images.uri);
    if (!this.job(plan.operationId).exists || !live.exists || live.size < 100) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    for (const suffix of ["-wal", "-shm", "-journal"]) if (new File(`${live.uri}${suffix}`).exists) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    if ((await expoFileSha256(live)).sha256 !== plan.currentSha256) throw new RestoreProtocolError("RESTORE_STALE_PREVIEW");
    const file = new File(this.job(plan.operationId), "return.atbackup");
    const source = await SQLite.openDatabaseAsync(live.name, { useNewConnection: true }, live.parentDirectory.uri);
    let contentSha256: string; const metadata = { backupId: uuid.v4(), createdAt: new Date().toISOString() };
    try {
      await source.execAsync("PRAGMA query_only=ON; PRAGMA foreign_keys=ON");
      const manifest = await this.driver.createSnapshot(source, new File(this.job(plan.operationId), "return.partial"), file, metadata, { files: expoSnapshotMedia(images) });
      contentSha256 = manifest.contentSha256;
    } finally { await source.closeAsync(); }
    if ((await expoFileSha256(live)).sha256 !== plan.currentSha256) throw new RestoreProtocolError("RESTORE_STALE_PREVIEW");
    const point = { operationId: plan.operationId, ...metadata, contentSha256, ...await expoFileSha256(file) };
    await this.verifyPoint(point); return point;
  }
}
