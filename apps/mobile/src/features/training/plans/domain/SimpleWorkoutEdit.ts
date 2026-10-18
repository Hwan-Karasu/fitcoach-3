import type { PlannedWorkout } from "./SimplePlanModel.ts";

export type SimpleWorkoutScope = "CURRENT" | "FOLLOWING" | "ALL";
export const simpleWorkoutScopeLabels: Readonly<Record<SimpleWorkoutScope, string>> = {
  CURRENT: "Текущая тренировка", FOLLOWING: "Текущая и все предстоящие тренировки", ALL: "Все тренировки",
};
export interface SimpleWorkoutEdit {
  readonly weekIndex: number;
  readonly workoutId: string;
  readonly workout: PlannedWorkout;
  readonly scope: SimpleWorkoutScope;
  readonly replaceConflicts?: readonly string[];
}
export interface SimpleWeek {
  readonly index: number;
  readonly workouts: readonly PlannedWorkout[];
}
export interface SimplePlanVersion {
  readonly id: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly title: string;
  readonly weeks: readonly SimpleWeek[];
}
export interface SimpleWorkoutDraft {
  readonly baseRevision: number;
  readonly input: SimpleWorkoutEdit;
  /** Тренировка, с которой начата правка: если план потом изменился, правки переносятся на новый план. */
  readonly baseWorkout?: PlannedWorkout;
}
export const simpleWorkoutDraftKey = (programId: string, weekIndex: number, workoutId: string) =>
  `workout:${programId}:${weekIndex}:${workoutId}`;
