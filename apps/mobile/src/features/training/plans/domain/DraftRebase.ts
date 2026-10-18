import { applyWeekOps, diffWeek } from "./PeriodizedRules.ts";
import type { PlannedWorkout } from "./SimplePlanModel.ts";

/**
 * Черновик правки сделан по старой ревизии: та же разница «исходное → черновик» переносится на текущий план
 * по родству. Изменения, сделанные с тех пор в плане (например, отдых из дневника), сохраняются.
 */
export function rebaseDraft(base: readonly PlannedWorkout[], edited: readonly PlannedWorkout[],
  current: readonly PlannedWorkout[], newId: () => string): readonly PlannedWorkout[] {
  return applyWeekOps(current, diffWeek(base, edited), newId).workouts;
}

export const REBASED_NOTICE = "План изменился после черновика: ваши правки перенесены на текущий план. Проверьте их перед сохранением.";
