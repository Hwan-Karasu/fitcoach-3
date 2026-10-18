import type { PlannedWorkout } from "../../plans/public.ts";
import type { WorkoutExecution } from "../domain/ExecutionModel.ts";
import { factVolume } from "./programMatrix.ts";

/** Сводка тренировки для экрана программы (UI-OWN-034): упражнения, засчитанные подходы из плановых, объём. */
export interface WorkoutProgress {
  readonly exercises: number;
  /** Плановых подходов. */
  readonly sets: number;
  /** Засчитанных плановых подходов; добавленная разминка не входит. */
  readonly done: number;
  /** Тоннаж всех засчитанных подходов, кг (§48.44), включая разминку. */
  readonly volumeKg: number;
}

export function workoutProgress(workout: PlannedWorkout, execution: WorkoutExecution | undefined): WorkoutProgress {
  const planned = workout.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id));
  const exerciseIds = new Set(workout.exercises.map((exercise) => exercise.id));
  const facts = [...(execution?.facts.values() ?? [])].filter((fact) => exerciseIds.has(fact.plannedExerciseId));
  return {
    exercises: workout.exercises.length,
    sets: planned.length,
    done: planned.filter((id) => execution?.facts.get(id)?.confirmed === true).length,
    volumeKg: facts.reduce((sum, fact) => sum + factVolume(fact), 0),
  };
}
