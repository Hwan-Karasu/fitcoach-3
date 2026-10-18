import type { PlanWeek } from "./PeriodizedModel.ts";

export interface WeekCopyRequest {
  readonly clientId: string;
  readonly programId: string;
  readonly mesocycleId: string;
  readonly sourceWeek: number;
  readonly targetWeek: number;
  readonly expectedRevision: number;
}
export type WeekCopyMode = "PLAN" | "PREFILL" | "CONFIRM";
export interface WeekCopyPreview {
  readonly revisionToken: string;
  readonly sourceSets: number;
  readonly targetSessions: number;
  readonly targetSets: number;
  readonly targetNotes: number;
}
export interface WeekCopyPort {
  preview(request: WeekCopyRequest): Promise<WeekCopyPreview>;
  copy(request: WeekCopyRequest, revisionToken: string, mode: WeekCopyMode, replaceExisting: boolean): Promise<void>;
}

/** Транзакцию передаёт composition root; домен не зависит от SQLite. */
export interface WeekPlansParticipant<Tx> {
  read(tx: Tx, request: WeekCopyRequest): Promise<Readonly<{ source: PlanWeek; target: PlanWeek }>>;
  replace(tx: Tx, request: WeekCopyRequest, now: Date): Promise<Readonly<{ source: PlanWeek; target: PlanWeek }>>;
  notify(clientId: string): void;
}
