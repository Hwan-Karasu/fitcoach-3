import type { WorkoutOutcome, WorkoutSession, WorkoutSlot } from "./ExecutionModel.ts";

/** Что исход тренировки сделал с календарём (ADR-048): для подсказки в дневнике. */
export interface CalendarOutcomeEffect {
  readonly kind: "MARKED" | "CLEARED";
  /** Начало записи, минуты от полуночи. */
  readonly startMinute: number;
}

export interface WorkoutOutcomeResult {
  readonly session: WorkoutSession;
  readonly calendar: CalendarOutcomeEffect | null;
}

/** Исход тренировки вместе с записью календаря на сегодня — одна транзакция; собирается в composition root. */
export interface WorkoutOutcomePort {
  setOutcome(slot: WorkoutSlot, outcome: WorkoutOutcome | null, expectedRevision: number | null, now?: Date): Promise<WorkoutOutcomeResult>;
}
