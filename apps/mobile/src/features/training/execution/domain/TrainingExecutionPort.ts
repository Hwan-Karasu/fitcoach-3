import type { ConfirmationMode, PreviousQuery, PreviousSet, SessionStatus, SetFact, SetType, SetValues, TrackingMetric,
  WorkoutExecution, WorkoutOutcome, WorkoutSession, WorkoutSlot } from "./ExecutionModel.ts";

/** Плановый подход, к которому относится факт, и профиль его упражнения (профиль знает каталог). */
export interface SetIdentity {
  readonly slot: WorkoutSlot;
  readonly plannedExerciseId: string;
  readonly exerciseId: string;
  readonly plannedSetId: string;
  readonly position: number;
  readonly metrics: readonly TrackingMetric[];
  /** Ревизия факта, которую видел экран; `null` — факта ещё нет. */
  readonly expectedRevision: number | null;
}

export interface SaveSetInput extends SetIdentity {
  readonly values: SetValues;
  /** Мини-сеты дроп-сета целиком (§48.60); у других типов — пусто. */
  readonly drops: readonly SetValues[];
  readonly rpe: number | null;
  readonly setType: SetType;
}

export interface SetSaveResult {
  readonly fact: SetFact;
  readonly session: WorkoutSession;
  /** Новый переход «не выполнен → выполнен» — повод запустить таймер отдыха (§48.55). */
  readonly confirmedNow: boolean;
}

export interface TrainingExecutionCommittedChange {
  readonly clientId: string;
  readonly programId: string;
}

/**
 * Владелец фактов тренировок (Feature 10). Ошибки: INVALID_METRIC, STALE_SESSION, FACT_NOT_FOUND,
 * DROP_STRUCTURE_LOCKED (§48.61).
 * Выполнение создаётся первым вводом (§48.34): просмотр дневника ничего не записывает.
 * Calendar и Credit Ledger отсюда не меняются (§48.39).
 */
export interface TrainingExecutionPort {
  getConfirmationMode(): Promise<ConfirmationMode>;
  /** Не ретроспективно: сохранённые факты и неподтверждённые значения остаются как есть (§48.53 п. 3). */
  setConfirmationMode(mode: ConfirmationMode): Promise<void>;
  getWorkout(slot: WorkoutSlot): Promise<WorkoutExecution>;
  /** Статусы всех начатых или разобранных тренировок программы клиента. */
  getProgramStatuses(clientId: string, programId: string): Promise<readonly SessionStatus[]>;
  /** §48.74–48.75: прошлые подтверждённые подходы этого клиента в этой программе; ключ — плановый подход. */
  getPrevious(slot: WorkoutSlot, queries: readonly PreviousQuery[], now?: Date): Promise<ReadonlyMap<string, PreviousSet>>;
  /** Ввод значений, «Пред.» или смена типа подхода: тот же факт по ID, подтверждение по режиму тренера. */
  saveSet(input: SaveSetInput, now?: Date): Promise<SetSaveResult>;
  /** Галочка ручного режима. */
  toggleSetConfirmation(identity: SetIdentity, now?: Date): Promise<SetSaveResult>;
  /** §48.31, §48.38: исход тренировки или `null` — снять исход. Факты не удаляются. */
  setOutcome(slot: WorkoutSlot, outcome: WorkoutOutcome | null, expectedRevision: number | null, now?: Date): Promise<WorkoutSession>;
  /** §48.84: фактическая дата проведения. */
  setActualDate(slot: WorkoutSlot, date: string, expectedRevision: number, now?: Date): Promise<WorkoutSession>;
  subscribeCommittedChanges(listener: (change: TrainingExecutionCommittedChange) => void): () => void;
}
