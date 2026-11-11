import { RestoreActionError, type RestoreActionErrorCode, type RestoreActionOutcome, type RestoreActionState,
  type RestoreActionsPort, type RestoreJobsPort, type RestorePreview } from "../domain/RestoreActions.ts";
import type { RestorePreparationObserver } from "../domain/RestorePreparation.ts";

interface Options {
  readonly enabled: boolean;
  readonly jobs: RestoreJobsPort;
  /** Read admission covers picker, private copies, validation and every reader handle. */
  readonly read: <T>(task: () => Promise<T>) => Promise<T>;
  readonly ready: () => boolean;
}
function code(error: unknown): RestoreActionErrorCode {
  return error instanceof RestoreActionError ? error.code : "RESTORE_SOURCE_UNAVAILABLE";
}
/** Confirmation never travels through ordinary command admission: maintenance must drain
 * that admission without waiting on its own operation. UI unmount does not stop a commit. */
export class RestoreActionsService implements RestoreActionsPort {
  private readonly options: Options;
  private readonly listeners = new Set<() => void>();
  private active = false;
  private preparingPreview = false;
  private cancelPreparation = false;
  private current: RestoreActionState;
  constructor(options: Options) {
    this.options = options; this.current = { available: options.enabled, phase: "IDLE", preview: null, point: null, notice: null, error: null };
  }
  get state(): RestoreActionState { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(patch: Partial<RestoreActionState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) try { listener(); } catch { /* Observer only. */ }
  }
  private async perform(phase: RestoreActionState["phase"], task: () => Promise<RestoreActionOutcome>,
    settings: Readonly<{ recovery?: boolean; preserveNotice?: boolean }> = {}): Promise<RestoreActionOutcome> {
    if (this.active) return { kind: "FAILED", code: "RESTORE_BUSY" };
    if (!this.current.available) return { kind: "FAILED", code: "RESTORE_UNAVAILABLE" };
    if (!settings.recovery && (!this.options.ready() || this.current.phase === "RECOVERY_REQUIRED")) return { kind: "FAILED", code: "RESTORE_NOT_READY" };
    this.active = true; this.publish({ phase, error: null, errorStage: null, ...(settings.preserveNotice ? {} : { notice: null }) });
    try { return await task(); }
    catch (error) {
      const failure = settings.recovery ? "RESTORE_RECOVERY_REQUIRED" : code(error);
      this.publish({ error: failure, errorStage: error instanceof RestoreActionError ? error.stage : null,
        ...(failure === "RESTORE_RECOVERY_REQUIRED" ? { phase: "RECOVERY_REQUIRED" as const } : {}) });
      return { kind: "FAILED", code: failure };
    } finally {
      this.active = false;
      if (this.current.phase !== "RECOVERY_REQUIRED") this.publish({ phase: this.current.preview === null ? "IDLE" : "PREVIEW" });
    }
  }
  refresh(): Promise<RestoreActionOutcome> {
    // A screen remounted during maintenance must not enqueue another point read.
    if (this.active || this.current.preview !== null) return Promise.resolve({ kind: "UPDATED" });
    // LOADING, не PREPARING: открытие экрана не должно выглядеть как новая подготовка копии (BKP-AUDIT-1 D3).
    return this.perform("LOADING", async () => {
      try { this.publish({ point: await this.options.read(() => this.options.jobs.readPoint()) }); }
      catch (error) { this.publish({ point: null }); throw error; }
      return { kind: "UPDATED" };
    }, { preserveNotice: true });
  }
  private prepare(task: (observe: RestorePreparationObserver) => Promise<RestorePreview | null>): Promise<RestoreActionOutcome> {
    if (this.current.preview !== null) return Promise.resolve({ kind: "FAILED", code: "RESTORE_BUSY" });
    return this.perform("PREPARING", async () => {
      this.preparingPreview = true; this.cancelPreparation = false;
      this.publish({ preparation: null, cancelRequested: false });
      let live = true;
      const observe: RestorePreparationObserver = (progress) => {
        if (live && this.preparingPreview && !this.cancelPreparation) this.publish({ preparation: { ...progress } });
      };
      try {
        const preview = await this.options.read(async () => {
          const value = await task(observe);
          if (this.cancelPreparation && value !== null) { await this.discard(value.id); return null; }
          return value;
        });
        if (preview === null) return { kind: "CANCELLED" };
        this.publish({ preview: Object.freeze({ ...preview }) }); return { kind: "UPDATED" };
      } finally { live = false; this.preparingPreview = false; this.publish({ preparation: null, cancelRequested: false }); }
    });
  }
  chooseFile(): Promise<RestoreActionOutcome> { return this.prepare((observe) => this.options.jobs.prepareFile(observe)); }
  previewReturn(): Promise<RestoreActionOutcome> {
    const point = this.current.point;
    return this.prepare(async (observe) => {
      if (point === null) throw new RestoreActionError("RESTORE_POINT_UNAVAILABLE");
      return this.options.jobs.prepareReturn(point.id, observe);
    });
  }
  private async discard(id: string): Promise<void> {
    try { await this.options.jobs.discard(id); } catch { /* A private orphan cannot become a confirmation. */ }
  }
  cancelPreview(): Promise<RestoreActionOutcome> {
    // Отмена подготовки — только явное действие пользователя (кнопка), не уход с экрана: операция принадлежит сервису.
    if (this.active && this.preparingPreview) { this.cancelPreparation = true; this.publish({ cancelRequested: true, preparation: null }); return Promise.resolve({ kind: "CANCELLED" }); }
    return this.perform("LOADING", async () => {
      const preview = this.current.preview; this.publish({ preview: null });
      if (preview !== null) await this.options.read(() => this.discard(preview.id));
      return { kind: "CANCELLED" };
    });
  }
  confirmPreview(id: string): Promise<RestoreActionOutcome> {
    return this.perform("APPLYING", async () => {
      const preview = this.current.preview;
      if (preview === null || preview.id !== id) throw new RestoreActionError("RESTORE_STALE_PREVIEW");
      try {
        // Один confirm — один apply: повтор отбрасывается флагом active в perform(); поздние события этапов после завершения
        // игнорируются, а сам apply не зависит от того, смонтирован ли экран.
        let live = true;
        let outcome: "COMMITTED" | "ROLLED_BACK";
        try { outcome = await this.options.jobs.apply(id, (phase) => { if (live) this.publish({ applying: phase }); }); }
        finally { live = false; this.publish({ applying: null }); }
        if (outcome !== "COMMITTED") throw new RestoreActionError("RESTORE_FAILED");
        this.publish({ preview: null, notice: preview.kind === "RESTORE" ? "RESTORED" : "RETURNED", point: null });
        await this.discard(id);
        try { this.publish({ point: await this.options.read(() => this.options.jobs.readPoint()) }); } catch { /* Refresh can retry; never undo a verified commit. */ }
        return { kind: preview.kind === "RESTORE" ? "RESTORED" : "RETURNED" };
      } catch (error) {
        if (code(error) !== "RESTORE_RECOVERY_REQUIRED") { this.publish({ preview: null }); await this.discard(id); }
        throw error;
      }
    });
  }
  deletePoint(id: string): Promise<RestoreActionOutcome> {
    return this.perform("DELETING", async () => {
      if (this.current.preview !== null || this.current.point?.id !== id) throw new RestoreActionError("RESTORE_STALE_PREVIEW");
      await this.options.jobs.deletePoint(id); this.publish({ point: null, notice: "POINT_DELETED" }); return { kind: "POINT_DELETED" };
    });
  }
  recover(): Promise<RestoreActionOutcome> {
    return this.perform("RECOVERING", async () => {
      const receipt = await this.options.jobs.recover();
      const preview = this.current.preview; this.publish({ preview: null, phase: "IDLE" });
      if (preview !== null) await this.discard(preview.id);
      if (preview !== null && receipt?.id === preview.id) {
        if (receipt.outcome === "COMMITTED") this.publish({ notice: preview.kind === "RESTORE" ? "RESTORED" : "RETURNED" });
        else this.publish({ error: "RESTORE_FAILED" });
      } else this.publish({ notice: "CHECKED" });
      try { this.publish({ point: await this.options.read(() => this.options.jobs.readPoint()) }); }
      catch { this.publish({ point: null, error: "RESTORE_POINT_UNAVAILABLE" }); }
      return { kind: "UPDATED" };
    }, { recovery: true });
  }
}
