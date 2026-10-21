import { applyWeekOps, diffWeek } from "./PeriodizedRules.ts";
import type { PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";

/**
 * Черновик правки сделан по старой ревизии: та же разница «исходное → черновик» переносится на текущий план
 * по родству. Изменения, сделанные с тех пор в плане (например, отдых из дневника), сохраняются.
 */
export function rebaseDraft(base: readonly PlannedWorkout[], edited: readonly PlannedWorkout[],
  current: readonly PlannedWorkout[], newId: () => string): readonly PlannedWorkout[] {
  return applyWeekOps(current, diffWeek(base, edited), newId).workouts;
}

export const REBASED_NOTICE = "План изменился после черновика: ваши правки перенесены на текущий план. Проверьте их перед сохранением.";

/**
 * Черновик Простого конструктора сделан по старой ревизии программы: правки тренера (разница «база → черновик») переносятся на
 * текущий план, а изменения, сделанные в плане с тех пор (отдых из дневника, правка тренировки), сохраняются. Название и число
 * недель берутся из черновика, только если тренер их менял.
 */
export function rebaseSimpleProgram(base: SimpleProgramDraft, draft: SimpleProgramDraft, current: SimpleProgramDraft,
  newId: () => string): SimpleProgramDraft {
  return {
    title: draft.title !== base.title ? draft.title : current.title,
    plan: {
      weeks: draft.plan.weeks !== base.plan.weeks ? draft.plan.weeks : current.plan.weeks,
      workouts: rebaseDraft(base.plan.workouts, draft.plan.workouts, current.plan.workouts, newId),
    },
  };
}
