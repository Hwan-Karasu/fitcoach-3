import { BackupStorageError, parsePublishedBackup, type BackupDestination, type BackupPublisherPort,
  type VerifiedBackupFile } from "../domain/BackupPublication.ts";
import { BackupRunClock, type BackupObserver, type BackupProgress } from "../domain/BackupProgress.ts";
import { ManualBackupError, type BackupLocationStore, type ManualBackupErrorCode, type ManualBackupOutcome,
  type ManualBackupPort, type ManualBackupState, type SavedBackupSummary } from "../domain/ManualBackupPort.ts";
import type { BackupExclusive } from "./BackupExclusive.ts";

interface Options {
  readonly enabled: boolean;
  readonly publisher: BackupPublisherPort;
  readonly locations: BackupLocationStore;
  readonly chooseDirectory: () => Promise<BackupDestination | null>;
  readonly prepare: (observe: BackupObserver) => Promise<VerifiedBackupFile>;
  readonly cleanup: (snapshot: VerifiedBackupFile) => Promise<void>;
  /** Runtime admission covers the complete operation, including the private reader and file IO. */
  readonly run: <T>(task: () => Promise<T>) => Promise<T>;
  /** Общая очередь с автокопией (BKP-LOCK-1): ручная копия дожидается идущей автокопии. */
  readonly exclusive: BackupExclusive;
  readonly clock?: () => number;
}
function errorCode(error: unknown): ManualBackupErrorCode {
  if (error instanceof ManualBackupError || error instanceof BackupStorageError) return error.code;
  return "BACKUP_SOURCE_UNAVAILABLE";
}
/** Manual files are outside automatic rotation. Export chooses a one-off destination and
 * never changes the stored folder. UI unmount only unsubscribes; the admitted operation
 * finishes safely and its state remains available when the user returns. */
export class ManualBackupService implements ManualBackupPort {
  private readonly options: Options;
  private readonly listeners = new Set<() => void>();
  private current: ManualBackupState;
  /** Папка последней неудачной копии — для «Повторить» (экспорт не просит выбрать папку снова). */
  private failedDestination: BackupDestination | null = null;
  constructor(options: Options) {
    this.options = options;
    this.current = { available: options.enabled && options.publisher.available, phase: "IDLE", progress: null, location: "UNKNOWN",
      lastSaved: null, error: null, errorStage: null, lastRun: null };
  }
  get state(): ManualBackupState { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(patch: Partial<ManualBackupState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) try { listener(); } catch { /* Observer cannot interrupt publication. */ }
  }
  private async perform(phase: ManualBackupState["phase"], task: () => Promise<ManualBackupOutcome>): Promise<ManualBackupOutcome> {
    if (this.current.phase !== "IDLE") return { kind: "FAILED", code: "BACKUP_BUSY" };
    if (!this.current.available) return { kind: "FAILED", code: "BACKUP_STORAGE_UNAVAILABLE" };
    this.publish({ phase, error: null, errorStage: null });
    try { return await this.options.run(task); }
    catch (error) {
      const code = errorCode(error);
      console.warn("[backup] MANUAL_FAILED", code, error instanceof ManualBackupError ? error.stage ?? "-" : "-");
      this.publish({ error: code, errorStage: error instanceof ManualBackupError ? error.stage : null }); return { kind: "FAILED", code };
    }
    finally { this.publish({ phase: "IDLE", progress: null }); }
  }
  refresh(): Promise<ManualBackupOutcome> {
    return this.perform("LOADING", async () => { this.publish({ location: (await this.options.locations.read()).kind }); return { kind: "UPDATED" }; });
  }
  chooseFolder(): Promise<ManualBackupOutcome> {
    return this.perform("CHOOSING", async () => {
      const destination = await this.options.chooseDirectory();
      if (destination === null) return { kind: "CANCELLED" };
      await this.options.locations.write(destination); this.publish({ location: destination.kind }); return { kind: "UPDATED" };
    });
  }
  useDefaultFolder(): Promise<ManualBackupOutcome> {
    return this.perform("LOADING", async () => {
      if (!this.options.publisher.supportsDownloads) throw new ManualBackupError("BACKUP_LOCATION_UNSUPPORTED");
      await this.options.locations.write({ kind: "DOWNLOADS" }); this.publish({ location: "DOWNLOADS" }); return { kind: "UPDATED" };
    });
  }
  createNow(): Promise<ManualBackupOutcome> {
    return this.perform("CREATING", async () => {
      const destination = await this.options.locations.read(); this.publish({ location: destination.kind });
      return this.save(destination);
    });
  }
  exportElsewhere(): Promise<ManualBackupOutcome> {
    return this.perform("CHOOSING", async () => {
      const destination = await this.options.chooseDirectory();
      return destination === null ? { kind: "CANCELLED" } : this.save(destination);
    });
  }
  retry(): Promise<ManualBackupOutcome> {
    const destination = this.failedDestination;
    return destination === null ? this.createNow() : this.perform("CREATING", () => this.save(destination));
  }
  private async save(destination: BackupDestination): Promise<ManualBackupOutcome> {
    if (destination.kind === "DOWNLOADS" && !this.options.publisher.supportsDownloads) throw new ManualBackupError("BACKUP_LOCATION_UNSUPPORTED");
    this.failedDestination = destination;
    if (this.options.exclusive.busy) this.publish({ phase: "WAITING", progress: null });
    const outcome = await this.options.exclusive.run(() => this.saveAdmitted(destination));
    this.failedDestination = null;
    return outcome;
  }
  private async saveAdmitted(destination: BackupDestination): Promise<ManualBackupOutcome> {
    const clock = new BackupRunClock(this.options.clock);
    const observe = (progress: BackupProgress) => { clock.mark(progress.stage); this.publish({ progress }); };
    this.publish({ phase: "CREATING", progress: null });
    const snapshot = await this.options.prepare(observe);
    try {
      this.publish({ phase: "PUBLISHING" }); observe({ stage: "PUBLISH", done: null, total: null });
      const result = await this.options.publisher.publish(snapshot, destination);
      // Defensive binding also covers a faulty future publisher implementation.
      const verified = parsePublishedBackup({ ...result, ok: true }, snapshot);
      const summary: SavedBackupSummary = { filename: verified.filename, createdAt: snapshot.createdAt, bytes: verified.bytes, location: destination.kind };
      const timing = clock.finish();
      console.info("[backup-timing] manual", timing.totalMs, timing.stages.map((s) => `${s.stage}=${s.ms}`).join(" "), verified.bytes);
      this.publish({ lastSaved: summary, lastRun: timing }); return { kind: "SAVED", backup: summary };
    } finally {
      try { await this.options.cleanup(snapshot); } catch { /* An unreferenced private job is not the published external backup. */ }
    }
  }
}
