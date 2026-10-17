/**
 * Дневник тренировки (Feature 10, §§48.23–48.84): одно выполнение на плановый слот, факты подходов
 * с устойчивой идентичностью. План (`plans/`) даёт контекст только для чтения.
 */

/** §33.2 Величины подхода (тот же контракт, что у каталога упражнений; профиль даёт каталог). */
export type TrackingMetric = "reps" | "load" | "addedLoad" | "assistance" | "duration" | "distance";

/** §48.48, §48.53: общий режим тренера; по умолчанию — автоматический. */
export type ConfirmationMode = "AUTO" | "MANUAL";

export const DEFAULT_CONFIRMATION_MODE: ConfirmationMode = "AUTO";

/** §48.57: тип относится к подходу. Дроп-сет с мини-сетами — отдельный срез. */
export type SetType = "NORMAL" | "WARMUP" | "FAILURE";

export const SET_TYPES: readonly SetType[] = ["NORMAL", "WARMUP", "FAILURE"];

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
  readonly rpe: number | null;
  readonly confirmed: boolean;
  readonly revision: number;
}

export interface WorkoutExecution {
  readonly session: WorkoutSession | null;
  /** Ключ — ID планового подхода. */
  readonly facts: ReadonlyMap<string, SetFact>;
}

/** §37.9: прошлый подход и его дата. */
export interface PreviousSet {
  readonly values: SetValues;
  readonly date: string;
}

/** Текущее упражнение тренировки глазами «Пред.»: слот плана и плановые подходы по порядку. */
export interface PreviousQuery {
  readonly plannedExerciseId: string;
  readonly exerciseId: string;
  readonly plannedSetIds: readonly string[];
}

/** Статус одной тренировки недели в программе клиента. */
export interface SessionStatus {
  readonly weekIndex: number;
  readonly plannedWorkoutId: string;
  readonly status: WorkoutStatus;
}
