import { AUTO_BACKUP_INTERVAL, type AutomaticBackupPort } from "../../features/backup/public.ts";
interface Clock {
  now(): number;
  schedule(afterMs: number, task: () => void): () => void;
}
const systemClock: Clock = { now: Date.now, schedule: (delay, task) => { const id = setTimeout(task, delay); return () => clearTimeout(id); } };
/** Visibility controls only attempts/timers. The admitted backup itself always settles. */
export class AutomaticBackupScheduler {
  private active = false;
  private disposed = false;
  private cancel: (() => void) | null = null;
  private readonly unsubscribe: () => void;
  private readonly backup: AutomaticBackupPort;
  private readonly clock: Clock;
  constructor(backup: AutomaticBackupPort, clock: Clock = systemClock) {
    this.backup = backup; this.clock = clock; this.unsubscribe = backup.subscribe(() => this.arm());
  }
  setActive(active: boolean): void {
    if (this.disposed) return;
    const resumed = active && !this.active; this.active = active;
    if (resumed && this.backup.state.available) this.check(); else this.arm();
  }
  private check(): void { void this.backup.check().finally(() => this.arm()).catch(() => undefined); }
  private arm(): void {
    this.cancel?.(); this.cancel = null;
    const state = this.backup.state;
    if (this.disposed || !this.active || !state.available || state.phase !== "IDLE" || state.nextCheckAt === null) return;
    this.cancel = this.clock.schedule(Math.max(1000, Math.min(AUTO_BACKUP_INTERVAL, state.nextCheckAt - this.clock.now())), () => { this.cancel = null; this.check(); });
  }
  dispose(): void { this.disposed = true; this.cancel?.(); this.cancel = null; this.unsubscribe(); }
}
