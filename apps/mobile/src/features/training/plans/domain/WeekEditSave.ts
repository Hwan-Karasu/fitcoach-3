import type { WeekEditInput, WeekEditResult } from "./PeriodizedModel.ts";

/**
 * Что сделать с результатами тренировок, которые правка недели убирает из плана: удалить окончательно или оставить в истории
 * (с неизменяемым снимком происхождения, как «Удалить план, сохранить историю»).
 */
export type RemovedResultsAction = "DELETE" | "KEEP_HISTORY";

/**
 * Сохранение правки недели Расширенной программы (§48.6): план у выбранных участников и работа с результатами — одной транзакцией
 * (ADR-031). Если правка убирает тренировку с результатами, без `resultsAction` — `WEEK_HAS_RESULTS`: тренер выбирает явно.
 */
export interface WeekEditSaveRequest {
  readonly clientId: string;
  readonly programId: string;
  readonly expectedRevision: number;
  readonly input: WeekEditInput;
  readonly resultsAction?: RemovedResultsAction;
}

export interface WeekEditSavePort {
  saveWeek(request: WeekEditSaveRequest): Promise<WeekEditResult>;
}

/** Слот выполнения участника (у копии группы своя программа и свой клиент) и подписи для снимка происхождения. */
export interface WeekEditSlot {
  readonly clientId: string;
  readonly programId: string;
  readonly weekIndex: number;
  readonly plannedWorkoutId: string;
  readonly programTitle: string;
  readonly mesocycleTitle: string;
  readonly workoutTitle: string;
}

/** Сторона планов в общей транзакции. */
export interface WeekEditSavePlansParticipant<Tx> {
  /** Тренировки, которые правка уберёт из планов выбранных участников. */
  removedWorkouts(tx: Tx, request: WeekEditSaveRequest): Promise<readonly WeekEditSlot[]>;
  save(tx: Tx, request: WeekEditSaveRequest, now: Date): Promise<WeekEditResult>;
  notify(clientIds: readonly string[]): void;
}
