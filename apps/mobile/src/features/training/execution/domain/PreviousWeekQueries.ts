import type { PreviousQuery } from "./ExecutionModel.ts";

/** Minimal read-only structure supplied by the plan owner; execution does not own the plan model. */
interface WeekWorkout {
  readonly id: string;
  readonly exercises: readonly Readonly<{ id: string; lineageId?: string; exerciseId: string;
    sets: readonly Readonly<{ id: string }>[] }>[];
}

/** Only an unambiguous occurrence of the same exercise in the corresponding prior-week workout. */
export function previousWeekQueries(workout: WeekWorkout, previous: WeekWorkout | null): readonly PreviousQuery[] {
  return workout.exercises.map((exercise) => {
    const matches = previous?.exercises.filter((source) => source.exerciseId === exercise.exerciseId
      && (source.lineageId ?? source.id) === (exercise.lineageId ?? exercise.id)) ?? [];
    return { plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId, plannedSetIds: exercise.sets.map((set) => set.id),
      source: matches.length === 1 ? { plannedWorkoutId: previous!.id, plannedExerciseId: matches[0]!.id } : null };
  });
}
