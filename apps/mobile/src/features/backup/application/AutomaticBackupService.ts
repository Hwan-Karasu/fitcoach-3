import type { BackupDestination } from "../domain/BackupPublication.ts";
import { AutomaticBackupError, AUTO_BACKUP_INTERVAL, automaticDay, automaticRetention, parseAutomaticCatalog, parseAutomaticPublication,
  sameBackupDestination, type AutomaticBackupFiles, type AutomaticBackupPort,
  type AutomaticBackupState, type AutomaticBackupStore, type AutomaticCatalog } from "../domain/AutomaticBackup.ts";

interface Options {
  readonly enabled: boolean;
  readonly files: AutomaticBackupFiles;
  readonly store: AutomaticBackupStore;
  readonly location: () => Promise<BackupDestination>;
  readonly run: <T>(task: () => Promise<T>) => Promise<T>;
  readonly ready: () => boolean;
  readonly now?: () => number;
  readonly offset?: () => number;
}
/** One admitted operation owns every reader/publication/cleanup. A durable pending job
 * replays the SAME native receipt; committed retention metadata precedes every old delete. */
export class AutomaticBackupService implements AutomaticBackupPort {
  private readonly options: Options;
  private readonly listeners = new Set<() => void>();
  private active = false;
  private current: AutomaticBackupState;
  constructor(options: Options) {
    this.options = options; this.current = { available: options.enabled && options.files.available, phase: "IDLE", nextCheckAt: null, lastSaved: null, versions: 0, error: null };
  }
  get state(): AutomaticBackupState { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish(patch: Partial<AutomaticBackupState>): void {
    this.current = { ...this.current, ...patch }; for (const listener of this.listeners) try { listener(); } catch { /* Observer only. */ }
  }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private offset(): number { return this.options.offset?.() ?? new Date().getTimezoneOffset(); }
  private async save(catalog: AutomaticCatalog): Promise<AutomaticCatalog> {
    const checked = parseAutomaticCatalog(catalog); await this.options.store.write(checked);
    const readback = await this.options.store.read();
    if (JSON.stringify(readback) !== JSON.stringify(checked)) throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE");
    return checked;
  }
  private summary(c: AutomaticCatalog): void {
    const last = c.entries[0]; this.publish({ versions: c.entries.length,
      lastSaved: last ? { createdAt: last.completedAt, day: last.day, filename: last.filename } : null });
  }
  private async retire(catalog: AutomaticCatalog): Promise<AutomaticCatalog> {
    let c = catalog;
    for (const old of c.retired) {
      try { await this.options.files.remove(old); }
      catch { throw new AutomaticBackupError("AUTO_CLEANUP_PENDING"); }
      c = await this.save({ ...c, retired: c.retired.filter((e) => e.backupId !== old.backupId) });
    }
    return c;
  }
  check(): Promise<void> { return this.perform(false); }
  retry(): Promise<void> { return this.perform(true); }
  private async perform(force: boolean): Promise<void> {
    if (this.active || !this.current.available || !this.options.ready()) return;
    this.active = true; this.publish({ phase: "CHECKING" });
    try { await this.options.run(async () => {
      const prior = await this.options.store.readFailure(); if (prior !== null) this.publish({ error: prior.code });
      try {
        await this.checkAdmitted(force);
        if (this.current.error === null) await this.options.store.writeFailure(null);
      } catch (error) {
        const code = error instanceof AutomaticBackupError ? error.code : "AUTO_SOURCE_UNAVAILABLE";
        try { await this.options.store.writeFailure({ code, at: this.now() }); } catch { /* Preserve catalog on a status-only IO failure. */ }
        throw error;
      }
    }); }
    catch (error) {
      if (error instanceof AutomaticBackupError && error.code === "AUTO_NOT_READY") { this.publish({ nextCheckAt: this.now() + 1000 }); return; }
      this.publish({ error: error instanceof AutomaticBackupError ? error.code : "AUTO_SOURCE_UNAVAILABLE", nextCheckAt: this.now() + AUTO_BACKUP_INTERVAL });
    } finally { this.active = false; this.publish({ phase: "IDLE" }); }
  }
  private async checkAdmitted(force: boolean): Promise<void> {
    let c = await this.options.store.read(); const now = this.now();
    if (c !== null) c = parseAutomaticCatalog(c);
    if (c === null) {
      let destination: BackupDestination;
      try { destination = await this.options.location(); } catch { throw new AutomaticBackupError("AUTO_FOLDER_UNAVAILABLE"); }
      c = await this.save({ version: 1, destination, sequence: 0, checkedAt: now, entries: [], retired: [], pending: null });
      if (!force) { this.publish({ nextCheckAt: now + AUTO_BACKUP_INTERVAL, error: null }); return; }
    }
    this.summary(c);
    if (!force && c.pending === null && c.retired.length === 0 && now >= c.checkedAt && now - c.checkedAt < AUTO_BACKUP_INTERVAL) {
      this.publish({ nextCheckAt: c.checkedAt + AUTO_BACKUP_INTERVAL }); return;
    }
    let destination: BackupDestination;
    try { destination = await this.options.location(); } catch { throw new AutomaticBackupError("AUTO_FOLDER_UNAVAILABLE"); }
    if (!sameBackupDestination(c.destination, destination)) {
      // A lost old grant must not prevent backing up into an explicitly selected new place.
      // Preserve its catalog/pending source; do not rotate or claim to transfer old files.
      await this.options.store.archive(c);
      c = await this.save({ version: 1, destination, sequence: 0, checkedAt: now, entries: [], retired: [], pending: null });
      force = true; this.summary(c);
    }
    c = await this.retire(c);
    if (!force && c.pending === null && now >= c.checkedAt && now - c.checkedAt < AUTO_BACKUP_INTERVAL) {
      this.publish({ nextCheckAt: c.checkedAt + AUTO_BACKUP_INTERVAL, error: null }); return;
    }
    for (const e of c.entries) await this.options.files.verify(e);
    if (c.pending === null) {
      automaticRetention(c.entries, new Date(now).toISOString(), this.offset());
      c = await this.save({ ...c, checkedAt: now });
      this.publish({ phase: "PREPARING", nextCheckAt: now + AUTO_BACKUP_INTERVAL });
      const prepared = await this.options.files.prepare(c.entries[0]?.contentSha256 ?? null);
      if (prepared === null) { this.publish({ error: null }); return; }
      c = await this.save({ ...c, pending: prepared });
    }
    const pending = c.pending!;
    automaticRetention(c.entries, new Date(this.now()).toISOString(), this.offset());
    // Validate retained files before publishing, never delete a healthy historical version
    // to compensate for an inaccessible/corrupt copy or a failed new publication.
    this.publish({ phase: "PUBLISHING" });
    const publication = parseAutomaticPublication(await this.options.files.publish(pending, c.destination), pending);
    const completedAt = new Date(this.now()).toISOString(); const offsetMinutes = this.offset();
    const historical = automaticRetention(c.entries, completedAt, offsetMinutes);
    const next = { ...pending, ...publication, completedAt, offsetMinutes, day: automaticDay(completedAt, offsetMinutes), sequence: c.sequence + 1 };
    const kept = [next, ...historical];
    c = await this.save({ ...c, sequence: next.sequence, checkedAt: this.now(), entries: kept,
      retired: c.entries.filter((e) => !historical.includes(e)), pending: null });
    this.summary(c); this.publish({ error: null, nextCheckAt: c.checkedAt + AUTO_BACKUP_INTERVAL });
    // Cleanup is separately retryable; its failure never mislabels a completed publication.
    try { await this.options.files.cleanup(pending.backupId); } catch { /* Private orphan. */ }
    await this.retire(c);
  }
}
