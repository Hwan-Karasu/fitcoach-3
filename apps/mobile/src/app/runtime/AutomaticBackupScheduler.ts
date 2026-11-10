import { AUTO_BACKUP_INTERVAL, type AutomaticBackupPort } from "../../features/backup/public.ts";
interface Clock {
  now(): number;
  schedule(afterMs: number, task: () => void): () => void;
}
/** Через сколько проверить снова, если автокопию отложила идущая тренировка. */
export const QUIET_RETRY_MS = 60 * 1000;
const systemClock: Clock = { now: Date.now, schedule: (delay, task) => { const id = setTimeout(task, delay); return () => clearTimeout(id); } };
/** Visibility controls only attempts/timers. The admitted backup itself always settles. */
export class AutomaticBackupScheduler {
  private active = false;
  private disposed = false;
  private cancel: (() => void) | null = null;
  private readonly unsubscribe: () => void;
  private readonly backup: AutomaticBackupPort;
  private readonly clock: Clock;
  private readonly quiet: () => boolean;
  /** `quiet` — тренировка не идёт (AUTO-BACKUP-3); иначе попытка откладывается на минуту, без цикла и без новой копии в фоне. */
  constructor(backup: AutomaticBackupPort, clock: Clock = systemClock, quiet: () => boolean = () => true) {
    this.backup = backup; this.clock = clock; this.quiet = quiet; this.unsubscribe = backup.subscribe(() => this.arm());
  }
  setActive(active: boolean): void {
    if (this.disposed) return;
    const resumed = active && !this.active; this.active = active;
    if (resumed && this.backup.state.available) this.check(); else this.arm();
  }
  private check(): void {
    if (!this.quiet()) { this.postpone(); return; }
    void Promise.resolve().then(() => this.backup.check()).finally(() => this.arm()).catch(() => undefined);
  }
  private postpone(): void {
    this.cancel?.(); this.cancel = null;
    if (this.disposed || !this.active) return;
    this.cancel = this.clock.schedule(QUIET_RETRY_MS, () => { this.cancel = null; this.check(); });
  }
  private arm(): void {
    this.cancel?.(); this.cancel = null;
    const state = this.backup.state;
    if (this.disposed || !this.active || !state.available || state.phase !== "IDLE" || state.nextCheckAt === null) return;
    this.cancel = this.clock.schedule(Math.max(1000, Math.min(AUTO_BACKUP_INTERVAL, state.nextCheckAt - this.clock.now())), () => { this.cancel = null; this.check(); });
  }
  dispose(): void { this.disposed = true; this.cancel?.(); this.cancel = null; this.unsubscribe(); }
}
