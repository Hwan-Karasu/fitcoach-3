import type { PlanWeek } from "./PeriodizedModel.ts";
import { copyWeeks } from "./PeriodizedRules.ts";

export interface CopyMesocycleInput {
  readonly sourceClientId: string;
  readonly sourceProgramId: string;
  readonly sourceMesocycleId: string;
  readonly sourceRevision: number;
  readonly title: string;
  readonly clientIds: readonly string[];
}

/** Число строк с ID (недели, тренировки, упражнения, подходы), без самого мезоцикла. */
export const weekRowCount = (weeks: readonly PlanWeek[]) => weeks.reduce((count, week) => count + 1
  + week.workouts.reduce((sum, workout) => sum + 1 + workout.exercises.reduce((n, exercise) => n + 1 + exercise.sets.length, 0), 0), 0);

/** Новые ID и новое родство; соответствие недель внутри копии сохраняется. */
export function independentWeeks(weeks: readonly PlanWeek[], newId: () => string): readonly PlanWeek[] {
  const lineages = new Map<string, string>();
  const lineage = (kind: string, id: string) => {
    const key = `${kind}:${id}`;
    if (!lineages.has(key)) lineages.set(key, newId());
    return lineages.get(key)!;
  };
  return copyWeeks(weeks, newId).map((week) => ({ ...week, workouts: week.workouts.map((workout) => ({ ...workout,
    lineageId: lineage("workout", workout.lineageId ?? workout.id),
    exercises: workout.exercises.map((exercise) => ({ ...exercise,
      lineageId: lineage("exercise", exercise.lineageId ?? exercise.id) })),
  })) }));
}
