export type StartupStage = "js.entry" | "react.layout" | "native.hidden" | "fonts.ready" | "animation.start"
  | "restore.recovery" | "database.prepare" | "repositories.initialize" | "timers.recover" | "theme.load"
  | "navigation.ready" | "launch.complete";
export interface StartupSample { readonly stage: StartupStage; readonly atMs: number; readonly durationMs?: number }

/** Bounded numeric trace. No workspace, SQL, paths or user data. Origin is JS entry, not Android process creation. */
export class StartupDiagnostics {
  private readonly origin: number;
  private readonly now: () => number;
  private readonly samples: StartupSample[] = [];
  constructor(now: () => number = () => performance.now()) { this.now = now; this.origin = now(); }
  mark(stage: StartupStage, durationMs?: number): void {
    if (this.samples.length >= 32) return;
    const atMs = Math.max(0, Math.round(this.now() - this.origin));
    this.samples.push({ stage, atMs, ...(durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(durationMs)) }) });
  }
  async measure<T>(stage: StartupStage, task: () => Promise<T>): Promise<T> {
    const from = this.now();
    try { return await task(); }
    finally { this.mark(stage, this.now() - from); }
  }
  snapshot(): readonly StartupSample[] { return this.samples.map((sample) => ({ ...sample })); }
}

export const startupDiagnostics = new StartupDiagnostics();
startupDiagnostics.mark("js.entry");
