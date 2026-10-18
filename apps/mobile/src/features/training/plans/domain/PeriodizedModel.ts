import type { TrainingProgram } from "./ProgramModel.ts";
import type { PlannedExercise, PlannedWorkout } from "./SimplePlanModel.ts";

/**
 * Расширенная программа (§48.3): книга мезоциклов, у каждой недели свой план (§48.4). У каждого участника —
 * своя независимая копия структуры (§48.28); «родство» (`lineageId`) связывает соответствующие тренировки и
 * упражнения разных недель и участников, чтобы правка с областью применения (§48.6) находила «то же самое».
 */

/** Типы недель — как в FitCoach 2.0 (решение владельца 2026-10-18). */
export type WeekType = "base" | "light" | "medium" | "heavy" | "deload";

export const WEEK_TYPES: readonly WeekType[] = ["base", "light", "medium", "heavy", "deload"];

export const weekTypeLabels: Readonly<Record<WeekType, string>> = {
  base: "Индивидуальная", light: "Лёгкая", medium: "Средняя", heavy: "Тяжёлая", deload: "Разгрузка",
};

export interface PlanWeek {
  readonly id: string;
  /** Номер недели в мезоцикле, с 1. */
  readonly index: number;
  readonly type: WeekType;
  readonly workouts: readonly PlannedWorkout[];
}

export interface Mesocycle {
  readonly id: string;
  /** Общий у копий мезоцикла разных участников. */
  readonly lineageId: string;
  readonly title: string;
  readonly weeks: readonly PlanWeek[];
}

/** §48.6: четыре области применения правки недели. */
export type WeekScope = "CURRENT" | "FOLLOWING" | "SAME_TYPE" | "ALL";

export const WEEK_SCOPES: readonly WeekScope[] = ["CURRENT", "FOLLOWING", "SAME_TYPE", "ALL"];

export const weekScopeLabels: Readonly<Record<WeekScope, string>> = {
  CURRENT: "Только эта неделя",
  FOLLOWING: "Эта и все следующие недели",
  SAME_TYPE: "Все недели этого типа",
  ALL: "Все недели мезоцикла",
};

export const MESOCYCLE_TITLE_MAX = 80;

/** Расширенная программа глазами одного участника: его копии мезоциклов и его выбор (§48.10). */
export interface PeriodizedPlan {
  readonly program: TrainingProgram;
  readonly mesocycles: readonly Mesocycle[];
  /** Последний выбранный мезоцикл этого клиента в этой программе; хранится в базе (§48.10 п. 6). */
  readonly selectedMesocycleId: string | null;
}

/** «+ Мезоцикл»: план первой недели копируется во все недели (решение владельца 2026-10-18). */
export interface NewMesocycleInput {
  readonly title: string;
  readonly weeks: number;
  readonly firstWeek: readonly PlannedWorkout[];
  /** Участники, которым создаётся своя копия (§48.12.3 п. 1); среди них — открывший клиент. */
  readonly clientIds: readonly string[];
}

/** Сохранение правки недели: что получилось, тип недели, область (§48.6.1) и участники (§48.6.2). */
export interface WeekEditInput {
  readonly mesocycleId: string;
  readonly weekIndex: number;
  readonly workouts: readonly PlannedWorkout[];
  readonly type: WeekType;
  readonly scope: WeekScope;
  readonly clientIds: readonly string[];
  /** Явные замены из предпросмотра этой же ревизии и правки; не перечисленные конфликты оставляют персональную структуру. */
  readonly replaceConflicts?: readonly string[];
}

export interface WeekEditConflict {
  readonly key: string;
  readonly clientId: string;
  readonly weekIndex: number;
  readonly workoutTitle: string;
  readonly exerciseId: string | null;
  readonly currentExercise?: PlannedExercise;
  readonly proposedExercise?: PlannedExercise;
  readonly operation: string;
  readonly reason: "PERSONAL_CHANGE" | "MISSING_EXERCISE" | "MISSING_WORKOUT" | "MISSING_MESOCYCLE";
  readonly canReplace: boolean;
}

export interface WeekEditPreview {
  readonly conflicts: readonly WeekEditConflict[];
  readonly affectedWeeks: readonly Readonly<{ clientId: string; weeks: readonly number[] }>[];
}

export interface WeekEditResult {
  readonly program: TrainingProgram;
  /** Правки, не применённые в других неделях/у других участников: нет соответствующего элемента. */
  readonly skipped: number;
}

export const MESOCYCLE_WEEKS_MAX = 52;
