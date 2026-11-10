import type { BackupObserver } from "./BackupProgress.ts";

export const RESTORE_PREPARATION_PHASES = ["COPY_SOURCE", "VERIFY_SOURCE", "PREPARE_CANDIDATE", "VERIFY_CURRENT", "READY"] as const;
export type RestorePreparationPhase = typeof RESTORE_PREPARATION_PHASES[number];
export interface RestorePreparationProgress {
  readonly phase: RestorePreparationPhase;
  readonly done: number | null;
  readonly total: number | null;
}
export type RestorePreparationObserver = (progress: RestorePreparationProgress) => void;

/** One operation owns its phase sequence. Logs contain only the generated job ID,
 * counters and timings; never database values, file URIs or client identities. */
export class RestorePreparationTrace {
  private current: RestorePreparationPhase = "COPY_SOURCE";
  private live = true;
  private pass = 0;
  private lastBucket = -1;
  private readonly started: number;
  private readonly id: string;
  private readonly observer: RestorePreparationObserver | undefined;
  private readonly now: () => number;
  private readonly log: (value: string) => void;
  constructor(id: string, observer?: RestorePreparationObserver,
    now: () => number = () => performance.now(),
    log: (value: string) => void = (value) => console.info("[restore]", value)) {
    this.id = id; this.observer = observer; this.now = now; this.log = log;
    this.started = now();
    this.phase("COPY_SOURCE");
  }
  phase(phase: RestorePreparationPhase): void {
    if (!this.live) return;
    this.current = phase; this.pass = 0; this.lastBucket = -1;
    this.emit(null, null);
    this.record("phase", null, null);
  }
  private emit(done: number | null, total: number | null): void {
    try { this.observer?.({ phase: this.current, done, total }); } catch { /* Observer only. */ }
  }
  private record(event: string, done: number | null, total: number | null): void {
    this.log(JSON.stringify({ operationId: this.id, event, phase: this.current, pass: this.pass, done, total,
      elapsedMs: Math.round(this.now() - this.started) }));
  }
  readonly observe: BackupObserver = ({ stage, done, total }) => {
    if (!this.live) return;
    if (stage === "VERIFY" && this.current === "COPY_SOURCE") this.phase("VERIFY_SOURCE");
    if (done === 0 && total !== null && total > 0) { this.pass++; this.lastBucket = -1; }
    this.emit(done, total);
    const bucket = done !== null && total !== null && total > 0 ? Math.floor(done / total * 10) : -1;
    if (bucket >= 0 && bucket !== this.lastBucket) { this.lastBucket = bucket; this.record("progress", done, total); }
  };
  finish(ok: boolean): void {
    if (!this.live) return;
    if (ok) { this.phase("READY"); this.emit(1, 1); }
    this.record(ok ? "complete" : "failed", null, null); this.live = false;
  }
}
