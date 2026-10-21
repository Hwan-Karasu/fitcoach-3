import type { WeekEditInput, WeekEditResult } from "./PeriodizedModel.ts";

/**
 * Сохранение правки недели Расширенной программы (§48.6): план у выбранных участников и проверка результатов — одной транзакцией
 * (ADR-031). Тренировка с результатами, которую правка убирает из плана, не исчезает молча: `WEEK_HAS_RESULTS`.
 */
export interface WeekEditSaveRequest {
  readonly clientId: string;
  readonly programId: string;
  readonly expectedRevision: number;
  readonly input: WeekEditInput;
}

export interface WeekEditSavePort {
  saveWeek(request: WeekEditSaveRequest): Promise<WeekEditResult>;
}

/** Слот выполнения участника: у копии группы своя программа и свой клиент. */
export interface WeekEditSlot {
  readonly clientId: string;
  readonly programId: string;
  readonly weekIndex: number;
  readonly plannedWorkoutId: string;
}

/** Сторона планов в общей транзакции. */
export interface WeekEditSavePlansParticipant<Tx> {
  /** Тренировки, которые правка уберёт из планов выбранных участников. */
  removedWorkouts(tx: Tx, request: WeekEditSaveRequest): Promise<readonly WeekEditSlot[]>;
  save(tx: Tx, request: WeekEditSaveRequest, now: Date): Promise<WeekEditResult>;
  notify(clientIds: readonly string[]): void;
}
