/** Этапы создания копии для экрана и замера (BKP-STAGE-1). `done/total` — только когда их можно честно посчитать
 * (строки базы, фото); иначе null — индикатор без процента. */
export type BackupStage = "SNAPSHOT" | "CONTENT" | "MEDIA" | "VERIFY" | "PUBLISH" | "ROTATE";
export interface BackupProgress {
  readonly stage: BackupStage;
  readonly done: number | null;
  readonly total: number | null;
}
export type BackupObserver = (progress: BackupProgress) => void;

export interface BackupStageTiming { readonly stage: BackupStage; readonly ms: number }
/** Итог последнего завершённого прогона: общее время и время каждого этапа (этап может встречаться несколько раз). */
export interface BackupRunTiming {
  readonly totalMs: number;
  readonly stages: readonly BackupStageTiming[];
}

/** Наблюдатель не влияет на результат копии: исключение экрана не прерывает запись. */
export function observeBackup(observer: BackupObserver | undefined, stage: BackupStage, done: number | null = null, total: number | null = null): void {
  try { observer?.({ stage, done, total }); } catch { /* Observer only. */ }
}

/** Секундомер этапов одного прогона. Смена этапа закрывает предыдущий; прогресс внутри этапа не создаёт новых отрезков. */
export class BackupRunClock {
  private readonly now: () => number;
  private readonly started: number;
  private current: { stage: BackupStage; since: number } | null = null;
  private readonly stages: BackupStageTiming[] = [];
  constructor(now: () => number = () => performance.now()) { this.now = now; this.started = now(); }
  mark(stage: BackupStage): void {
    if (this.current?.stage === stage) return;
    const at = this.now(); this.close(at); this.current = { stage, since: at };
  }
  private close(at: number): void {
    if (this.current !== null) this.stages.push({ stage: this.current.stage, ms: Math.round(at - this.current.since) });
    this.current = null;
  }
  finish(): BackupRunTiming {
    const at = this.now(); this.close(at);
    return { totalMs: Math.round(at - this.started), stages: [...this.stages] };
  }
}
