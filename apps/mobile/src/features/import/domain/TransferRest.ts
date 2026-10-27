import { CYCLE_REST_SEC, DEFAULT_REST_SEC } from "../../../shared/training-transfer/CycleRest.ts";
import type { TransferCycle } from "../../../shared/training-transfer/TrainingTransfer.ts";

/**
 * Источники без времени отдыха (файлы 2.0, пустой столбец) дают программу, где у всех упражнений «Без таймера». Если ни у одного
 * упражнения цикла отдыха нет вовсе, ставится отдых по типу цикла; цикл, где отдых задан хотя бы у одного упражнения, не меняется:
 * там пустое значение — сознательно выключенный таймер.
 */
export function fillRestWhenAbsent(cycles: readonly TransferCycle[]): readonly TransferCycle[] {
  return cycles.map((cycle) => {
    const exercises = cycle.weeks.flatMap((week) => week.workouts.flatMap((workout) => workout.exercises));
    if (exercises.length === 0 || exercises.some((exercise) => exercise.restSec !== null)) return cycle;
    const restSec = cycle.cycleType == null ? DEFAULT_REST_SEC : CYCLE_REST_SEC[cycle.cycleType];
    return { ...cycle, weeks: cycle.weeks.map((week) => ({ ...week, workouts: week.workouts.map((workout) => ({ ...workout,
      exercises: workout.exercises.map((exercise) => ({ ...exercise, restSec })) })) })) };
  });
}
