/**
 * Дневник тренировки (Feature 10, §§48.23–48.84): одно выполнение на плановый слот, факты подходов
 * с устойчивой идентичностью. План (`plans/`) даёт контекст только для чтения.
 */

/** §33.2 Величины подхода (тот же контракт, что у каталога упражнений; профиль даёт каталог). */
export type TrackingMetric = "reps" | "load" | "addedLoad" | "assistance" | "duration" | "distance";

/** §48.48, §48.53: общий режим тренера; по умолчанию — автоматический. */
export type ConfirmationMode = "AUTO" | "MANUAL";

export const DEFAULT_CONFIRMATION_MODE: ConfirmationMode = "AUTO";

/** §48.57: тип относится к подходу. Дроп-сет — один подход из нескольких мини-сетов (§48.60). */
export type SetType = "NORMAL" | "WARMUP" | "FAILURE" | "DROP";

export const SET_TYPES: readonly SetType[] = ["NORMAL", "WARMUP", "FAILURE", "DROP"];

/** Мини-сетов после основного у дроп-сета: от 1 до 9. */
export const DROPS_MAX = 9;

/** §48.31: три взаимоисключающих итоговых исхода тренировки дневника. */
export type WorkoutOutcome = "COMPLETED" | "MISSED" | "CANCELLED";

export type WorkoutStatus = "NOT_STARTED" | "IN_PROGRESS" | WorkoutOutcome;

/** §48.26, §48.46: статус недели вычисляется из исходов тренировок, кнопки «Завершить неделю» нет. */
export type WeekStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "CLOSED_WITH_DEVIATIONS";

/** Фактические значения подхода; вес — в граммах. `0` — значение, `null` — пусто (§48.52 п. 3). */
export interface SetValues {
  readonly reps: number | null;
  readonly loadGrams: number | null;
  readonly durationSec: number | null;
  readonly distanceM: number | null;
}

export const EMPTY_VALUES: SetValues = { reps: null, loadGrams: null, durationSec: null, distanceM: null };

/** Сторона одностороннего упражнения (§48.66, §48.70). */
export type Side = "L" | "R";

/** Значения и отметка выполнения одной стороны. */
export interface SideFact {
  readonly values: SetValues;
  readonly confirmed: boolean;
}

/** Обе стороны одного подхода: каждая заполняется и засчитывается отдельно. */
export interface SetSides {
  readonly left: SideFact;
  readonly right: SideFact;
}

/** Плановый слот: неделя Простой программы × плановая тренировка у конкретного клиента (§48.33). */
export interface WorkoutSlot {
  readonly clientId: string;
  readonly programId: string;
  readonly weekIndex: number;
  readonly plannedWorkoutId: string;
}

export interface WorkoutSession extends WorkoutSlot {
  readonly id: string;
  readonly outcome: WorkoutOutcome | null;
  /** §48.84: фактическая дата `YYYY-MM-DD`, по умолчанию — день первого ввода. */
  readonly actualDate: string;
  /**
   * Отметки фактического времени занятия (PC §48.86.10/13): момент в UTC (`…Z`). Начало — автоматически при первом подтверждённом
   * подходе, окончание — при «Завершить»; обе правятся вручную. `null` — не задано; длительность — только при валидной паре.
   */
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly revision: number;
}

/** Факт подхода: одна строка на плановый подход в выполнении; ID не меняется при правках (§48.25). */
export interface SetFact {
  readonly id: string;
  readonly plannedSetId: string;
  readonly plannedExerciseId: string;
  readonly exerciseId: string;
  /** Номер подхода в упражнении на момент записи — для сопоставления «Пред.» по порядку. */
  readonly position: number;
  readonly setType: SetType;
  readonly values: SetValues;
  /** Мини-сеты дроп-сета после основного (основной — `values`); у других типов пусто. */
  readonly drops: readonly SetValues[];
  readonly rpe: number | null;
  /**
   * Подход засчитан. У одностороннего — засчитана хотя бы одна сторона (§48.80): частично выполненный
   * подход — всё равно один подход.
   */
  readonly confirmed: boolean;
  /** Стороны одностороннего упражнения; у обычного — `null` (значения в `values`). */
  readonly sides: SetSides | null;
  /** Дополнительный разминочный подход дневника сверх плана (как в 2.0); у плановых — false. */
  readonly extra: boolean;
  readonly revision: number;
}

export interface WorkoutExecution {
  readonly session: WorkoutSession | null;
  /** Ключ — ID планового подхода. */
  readonly facts: ReadonlyMap<string, SetFact>;
  /** §48.67: заметки о фактическом выполнении; ключ — плановое упражнение. */
  readonly notes: ReadonlyMap<string, string>;
}

export const NOTE_MAX = 1000;

/** §37.9: прошлый подход и его дата. */
export interface PreviousSet {
  readonly values: SetValues;
  readonly drops: readonly SetValues[];
  /** Засчитанные стороны прошлого подхода; незасчитанной стороны нет (§48.81 п. 3). */
  readonly sides: Readonly<{ left: SetValues | null; right: SetValues | null }> | null;
  readonly date: string;
}

/** Текущее упражнение тренировки глазами «Пред.»: слот плана и плановые подходы по порядку. */
export interface PreviousQuery {
  readonly plannedExerciseId: string;
  readonly exerciseId: string;
  readonly plannedSetIds: readonly string[];
}

/** Начатая и ещё не разобранная тренировка клиента (§48.83). */
export interface ActiveWorkout extends WorkoutSlot {
  readonly actualDate: string;
}

/** Карточка быстрого перехода: кто и что сейчас тренирует. */
export interface ActiveWorkoutCard {
  readonly slot: WorkoutSlot;
  readonly clientName: string;
  readonly programTitle: string;
  readonly workoutTitle: string;
}

/** Тренировки «в работе» у всех клиентов с подписями — собирается в слое приложения. */
export interface ActiveWorkoutsPort {
  list(): Promise<readonly ActiveWorkoutCard[]>;
  subscribe(listener: () => void): () => void;
}

/** Статус одной тренировки недели в программе клиента. */
export interface SessionStatus {
  readonly weekIndex: number;
  readonly plannedWorkoutId: string;
  readonly status: WorkoutStatus;
}
