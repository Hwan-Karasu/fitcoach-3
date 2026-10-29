import type { WorkoutOutcomeResult } from "./WorkoutOutcomePort.ts";
import type { ActiveWorkout, ConfirmationMode, PreviousQuery, Side, PreviousSet, SessionStatus, SetFact, SetType, SetValues, TrackingMetric,
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
  /** Обе стороны одностороннего упражнения (§48.66); у обычного — не задаются, значения в `values`. */
  readonly sides?: Readonly<{ left: SetValues; right: SetValues }>;
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
/** Выполнение одной тренировки программы — для матрицы недель. */
export interface ProgramExecution {
  readonly weekIndex: number;
  readonly plannedWorkoutId: string;
  readonly execution: WorkoutExecution;
}

/** Неизменяемое происхождение занятия, когда план удалён с сохранением истории (§50.3, действие 1). */
export interface SessionOrigin {
  readonly programTitle: string;
  readonly programKind: "SIMPLE" | "PERIODIZED";
  readonly mesocycleTitle: string | null;
  readonly workoutTitle: string | null;
}

/** Выполнение клиента в любой его программе (§48.85, история занятий). */
export interface ClientExecution extends ProgramExecution {
  readonly programId: string;
  /** Снимок происхождения, если план уже удалён; `null` — план существует. */
  readonly origin: SessionOrigin | null;
}

export interface TrainingExecutionPort {
  getConfirmationMode(): Promise<ConfirmationMode>;
  /** Не ретроспективно: сохранённые факты и неподтверждённые значения остаются как есть (§48.53 п. 3). */
  setConfirmationMode(mode: ConfirmationMode): Promise<void>;
  getWorkout(slot: WorkoutSlot): Promise<WorkoutExecution>;
  /** Один снимок для дневника и «Пред.». Promise запросов позволяет параллельно читать план; разминки включаются автоматически. */
  getWorkoutWithPrevious(slot: WorkoutSlot, queries: readonly PreviousQuery[] | Promise<readonly PreviousQuery[]>, now?: Date):
    Promise<Readonly<{ current: WorkoutExecution; previous: ReadonlyMap<string, PreviousSet> }>>;
  /** §48.83: начатые и не разобранные тренировки всех клиентов; последний ввод — первым. */
  listActiveWorkouts(): Promise<readonly ActiveWorkout[]>;
  /**
   * Матрица недель (T05): все выполнения программы клиента с их фактами — одним вызовом; порядок не важен.
   * Только чтение; без выполнений — пустой список.
   */
  listProgramExecutions(clientId: string, programId: string): Promise<readonly ProgramExecution[]>;
  /** §48.85: все выполнения клиента во всех его программах (активных и архивных) — для единой хронологии. */
  listClientExecutions(clientId: string): Promise<readonly ClientExecution[]>;
  /** Статусы всех начатых или разобранных тренировок программы клиента. */
  getProgramStatuses(clientId: string, programId: string): Promise<readonly SessionStatus[]>;
  /** Owner correction 2026-10-24: confirmed sets of the corresponding workout in week N-1 of this cycle/program.
   * Week 1 or no counterpart/results: empty. No fallback to other weeks, workouts, cycles or programs. */
  getPrevious(slot: WorkoutSlot, queries: readonly PreviousQuery[], now?: Date): Promise<ReadonlyMap<string, PreviousSet>>;
  /**
   * Максимальный вес (граммы) клиента по упражнениям каталога за все его занятия, кроме указанной тренировки: подтверждённые
   * обычные и отказные подходы (разминка и мини-сеты не входят), у односторонних — подтверждённые стороны. Упражнения без веса
   * в ответе нет. Текущую тренировку экран добавляет сам из своего состояния.
   */
  getMaxLoads(slot: WorkoutSlot, exerciseIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** Ввод значений, «Пред.» или смена типа подхода: тот же факт по ID, подтверждение по режиму тренера. */
  saveSet(input: SaveSetInput, now?: Date): Promise<SetSaveResult>;
  /**
   * Разминка (как в 2.0): новый дополнительный разминочный подход сверху упражнения; плановые подходы
   * не меняются. Его ключ — `fact.plannedSetId`.
   */
  addWarmupSet(slot: WorkoutSlot, where: Readonly<{ plannedExerciseId: string; exerciseId: string }>,
    now?: Date): Promise<SetSaveResult>;
  /** Убрать дополнительный разминочный подход: скрывается из дневника, «Пред.» и статистики; запись остаётся. */
  removeWarmupSet(slot: WorkoutSlot, plannedSetId: string, expectedRevision: number, now?: Date): Promise<void>;
  /** Галочка ручного режима; у одностороннего — галочка своей стороны. */
  toggleSetConfirmation(identity: SetIdentity, now?: Date, side?: Side): Promise<SetSaveResult>;
  /** §48.31, §48.38: исход тренировки или `null` — снять исход. Факты не удаляются. */
  setOutcome(slot: WorkoutSlot, outcome: WorkoutOutcome | null, expectedRevision: number | null, now?: Date): Promise<WorkoutSession>;
  /**
   * ADR-048: то же, но «Завершить тренировку» ещё отмечает сегодняшнюю запись календаря (одна транзакция). Подключается в composition
   * root; без него дневник использует `setOutcome`.
   */
  setOutcomeWithCalendar?(slot: WorkoutSlot, outcome: WorkoutOutcome | null, expectedRevision: number | null, now?: Date): Promise<WorkoutOutcomeResult>;
  /**
   * §48.67: заметка о том, как прошло упражнение в этой тренировке; пустая — убирается. Не план и не
   * начало тренировки (статус по-прежнему по введённым подходам).
   */
  saveExerciseNote(slot: WorkoutSlot, plannedExerciseId: string, text: string, now?: Date): Promise<void>;
  /**
   * §48.30: окончательно удалить выполнение тренировки — подходы, мини-сеты, стороны, заметки, исход и дату.
   * Плановая тренировка остаётся; Calendar и абонемент не меняются.
   */
  deleteWorkoutExecution(slot: WorkoutSlot, expectedRevision: number): Promise<void>;
  /** §48.84: фактическая дата проведения. */
  setActualDate(slot: WorkoutSlot, date: string, expectedRevision: number, now?: Date): Promise<WorkoutSession>;
  /** Ручная правка отметок времени занятия (PC §48.86.13): момент UTC или `null`; CAS по ревизии выполнения. Исход и факты не меняются. */
  setTimes(slot: WorkoutSlot, times: Readonly<{ startedAt: string | null; finishedAt: string | null }>, expectedRevision: number,
    now?: Date): Promise<WorkoutSession>;
  subscribeCommittedChanges(listener: (change: TrainingExecutionCommittedChange) => void): () => void;
}
