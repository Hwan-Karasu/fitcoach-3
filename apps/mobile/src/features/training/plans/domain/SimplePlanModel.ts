/**
 * Структура Простой программы (§48.2, §48.4): базовая неделя повторяется каждую неделю.
 * ID тренировок, упражнений и подходов стабильны между сохранениями — к ним привяжутся факты (§48.5.7).
 */

/** Плановые значения подхода. Какие поля используются — решает профиль учёта упражнения (§33). */
export interface PlannedSet {
  readonly id: string;
  readonly reps: number | null;
  /** Вес, доп. вес или помощь — в граммах, чтобы 62,5 и 1,25 кг хранились точно. */
  readonly loadGrams: number | null;
  readonly durationSec: number | null;
  readonly distanceM: number | null;
}

export interface PlannedExercise {
  readonly id: string;
  /** Стабильный ID упражнения каталога (`sys:repdb:…` или `usr:…`). */
  readonly exerciseId: string;
  /** §48.56: свой отдых упражнения в секундах; `null` — таймер у упражнения выключен. */
  readonly restSec: number | null;
  readonly sets: readonly PlannedSet[];
}

export interface PlannedWorkout {
  readonly id: string;
  readonly title: string;
  readonly exercises: readonly PlannedExercise[];
}

export interface SimplePlan {
  readonly weeks: number;
  readonly workouts: readonly PlannedWorkout[];
}

/** Содержимое конструктора: название программы и её структура (то, что сохраняется и в черновик). */
export interface SimpleProgramDraft {
  readonly title: string;
  readonly plan: SimplePlan;
}

export const WEEKS_MIN = 1;
export const WEEKS_MAX = 52;
export const DEFAULT_WEEKS = 4;

/** Отдых нового упражнения и допустимые границы: барабан 0–60 мин и 0–59 с (решение владельца 2026-10-18). */
export const REST_DEFAULT_SEC = 90;
export const REST_MIN_SEC = 1;
export const REST_MAX_SEC = 3600;
