import { BackupStorageError, parsePublishedBackup, type BackupDestination, type BackupPublisherPort,
  type VerifiedBackupFile } from "../domain/BackupPublication.ts";
import { ManualBackupError, type BackupLocationStore, type ManualBackupErrorCode, type ManualBackupOutcome,
  type ManualBackupPort, type ManualBackupState, type SavedBackupSummary } from "../domain/ManualBackupPort.ts";

interface Options {
  readonly enabled: boolean;
  readonly publisher: BackupPublisherPort;
  readonly locations: BackupLocationStore;
  readonly chooseDirectory: () => Promise<BackupDestination | null>;
  readonly prepare: () => Promise<VerifiedBackupFile>;
  readonly cleanup: (snapshot: VerifiedBackupFile) => Promise<void>;
  /** Runtime admission covers the complete operation, including the private reader and file IO. */
  readonly run: <T>(task: () => Promise<T>) => Promise<T>;
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
  constructor(options: Options) {
    this.options = options;
    this.current = { available: options.enabled && options.publisher.available, phase: "IDLE", location: "UNKNOWN", lastSaved: null, error: null };
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
    this.publish({ phase, error: null });
    try { return await this.options.run(task); }
    catch (error) { const code = errorCode(error); this.publish({ error: code }); return { kind: "FAILED", code }; }
    finally { this.publish({ phase: "IDLE" }); }
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
  private async save(destination: BackupDestination): Promise<ManualBackupOutcome> {
    if (destination.kind === "DOWNLOADS" && !this.options.publisher.supportsDownloads) throw new ManualBackupError("BACKUP_LOCATION_UNSUPPORTED");
    this.publish({ phase: "CREATING" });
    const snapshot = await this.options.prepare();
    try {
      this.publish({ phase: "PUBLISHING" });
      const result = await this.options.publisher.publish(snapshot, destination);
      // Defensive binding also covers a faulty future publisher implementation.
      const verified = parsePublishedBackup({ ...result, ok: true }, snapshot);
      const summary: SavedBackupSummary = { filename: verified.filename, createdAt: snapshot.createdAt, bytes: verified.bytes, location: destination.kind };
      this.publish({ lastSaved: summary }); return { kind: "SAVED", backup: summary };
    } finally {
      try { await this.options.cleanup(snapshot); } catch { /* An unreferenced private job is not the published external backup. */ }
    }
  }
}
