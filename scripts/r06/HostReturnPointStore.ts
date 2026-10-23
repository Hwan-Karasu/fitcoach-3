import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseReturnPoint, parseReturnPointState, parseRestoreCompletionIntent, type RestoreCompletionIntent,
  type RestorePlan, type RestoreSlot, type ReturnPoint, type ReturnPointState, type ReturnPointStore } from "../../apps/mobile/src/features/backup/public.ts";
import { parsePendingRuntimeRestore } from "../../apps/mobile/src/app/bootstrap/recoverRuntimeRestore.ts";
import type { RuntimeRestoreJournal } from "../../apps/mobile/src/app/runtime/JournaledRestore.ts";
import { createSqliteBackup, validateSqliteBackup } from "./SqliteBackup.ts";
import { HostRestoreStorage } from "./HostRestoreStorage.ts";

export const fileHash = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
export class HostManagedRestoreStorage extends HostRestoreStorage {
  private readonly jobDirectory: string;
  constructor(root: string, operationId: string, boundary: (event: string) => void = () => undefined) {
    super(root, boundary); this.jobDirectory = join(root, "jobs", operationId); mkdirSync(this.jobDirectory, { recursive: true });
  }
  override path(slot: RestoreSlot): string { return slot === "LIVE" ? join(this.directory, "live.db") : join(this.jobDirectory, `${slot.toLowerCase()}.db`); }
  override guardPath(): string { return join(this.jobDirectory, "guard.json"); }
}

/** Host filesystem driver only. Production state machine is the shared mobile service. */
export class HostReturnPointStore implements ReturnPointStore {
  readonly root: string;
  readonly images: string;
  readonly boundary: (event: string) => void;
  constructor(root: string, images: string, boundary: (event: string) => void = () => undefined) { this.root = root; this.images = images; this.boundary = boundary; }
  private job(operationId: string): string {
    // Validate UUID without trusting any imported path.
    parsePendingRuntimeRestore({ version: 2, operationId, currentSha256: "0".repeat(64), incomingSha256: "0".repeat(64) });
    return join(this.root, "jobs", operationId);
  }
  pointFile(point: ReturnPoint): string { return join(this.job(parseReturnPoint(point).operationId), "return.atbackup"); }
  private read(file: string): unknown | null {
    if (!existsSync(file)) return null;
    const content = readFileSync(file, "utf8"); if (content.length > 32768) throw new Error("R06_RECORD_INVALID");
    const value: unknown = JSON.parse(content); if (value === null) throw new Error("R06_RECORD_INVALID"); return value;
  }
  private write(file: string, value: unknown, event: string, exclusive: boolean): void {
    if (exclusive && existsSync(file)) throw new Error("R06_RECORD_EXISTS");
    const next = `${file}-${randomUUID()}.next`; const fd = openSync(next, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    this.boundary(`${event}:pending`);
    renameSync(next, file); this.boundary(`${event}:published`);
  }
  async readState(): Promise<unknown | null> { return this.read(join(this.root, "return-state.json")); }
  async writeState(state: ReturnPointState): Promise<void> { this.write(join(this.root, "return-state.json"), parseReturnPointState(state), "state", false); }
  async readIntent(operationId: string): Promise<unknown | null> { return this.read(join(this.job(operationId), "completion.json")); }
  async writeIntent(input: RestoreCompletionIntent): Promise<void> {
    const intent = parseRestoreCompletionIntent(input); this.write(join(this.job(intent.operationId), "completion.json"), intent, "intent", true);
  }
  async verifyPoint(input: ReturnPoint): Promise<void> {
    const point = parseReturnPoint(input); const file = this.pointFile(point);
    if (readFileSync(file).length !== point.bytes || fileHash(file) !== point.sha256) throw new Error("R06_POINT_INVALID");
    const manifest = await validateSqliteBackup(file);
    if (manifest.backupId !== point.backupId || manifest.createdAt !== point.createdAt || manifest.contentSha256 !== point.contentSha256 ||
      fileHash(file) !== point.sha256) throw new Error("R06_POINT_INVALID");
  }
  async removePoint(point: ReturnPoint): Promise<void> {
    const file = this.pointFile(point); if (!existsSync(file)) return;
    if (fileHash(file) !== point.sha256) throw new Error("R06_POINT_INVALID");
    unlinkSync(file); this.boundary("point:removed");
  }
  async createPoint(plan: RestorePlan): Promise<ReturnPoint> {
    const live = join(this.root, "live.db"); if (fileHash(live) !== plan.currentSha256) throw new Error("R06_STALE");
    const file = join(this.job(plan.operationId), "return.atbackup");
    const metadata = { backupId: randomUUID(), createdAt: "2026-10-23T12:00:00.000Z" };
    const db = new DatabaseSync(live, { readOnly: true });
    let contentSha256: string;
    try { contentSha256 = (await createSqliteBackup(db, `${file}.partial`, file, metadata, { mediaRoot: this.images })).contentSha256; }
    finally { db.close(); }
    const point = { operationId: plan.operationId, ...metadata, contentSha256, sha256: fileHash(file), bytes: readFileSync(file).length };
    await this.verifyPoint(point);
    if (fileHash(live) !== plan.currentSha256) throw new Error("R06_STALE");
    this.boundary("point:sealed"); return point;
  }
  journal(): RuntimeRestoreJournal {
    return {
      readPending: async () => { const value = this.read(join(this.root, "pending.json")); return value === null ? null : { value }; },
      readGuard: async (operationId) => this.read(join(this.job(operationId), "guard.json")),
      publish: async (plan) => this.write(join(this.root, "pending.json"), parsePendingRuntimeRestore(plan), "journal", false),
    };
  }
}
