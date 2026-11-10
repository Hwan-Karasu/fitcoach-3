import { applyWeekOps, diffWeek } from "./PeriodizedRules.ts";
import type { BuilderWeek } from "./PeriodizedModel.ts";
import type { PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";

/**
 * Черновик правки сделан по старой ревизии: та же разница «исходное → черновик» переносится на текущий план
 * по родству. Изменения, сделанные с тех пор в плане (например, отдых из дневника), сохраняются.
 */
export function rebaseDraft(base: readonly PlannedWorkout[], edited: readonly PlannedWorkout[],
  current: readonly PlannedWorkout[], newId: () => string): readonly PlannedWorkout[] {
  return applyWeekOps(current, diffWeek(base, edited), newId).workouts;
}

/** Родство нужно только Расширенной программе: у Простой его нет (SimplePlanModel), перенос правок его не оставляет. */
function withoutLineage(workouts: readonly PlannedWorkout[]): readonly PlannedWorkout[] {
  return workouts.map(({ lineageId: workoutLineage, ...workout }) => {
    void workoutLineage;
    return { ...workout, exercises: workout.exercises.map(({ lineageId: exerciseLineage, ...exercise }) => {
      void exerciseLineage;
      return exercise;
    }) };
  });
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
      workouts: withoutLineage(rebaseDraft(base.plan.workouts, draft.plan.workouts, current.plan.workouts, newId)),
    },
  };
}

/**
 * Мезоцикл изменился после черновика конструктора: правки тренера по каждой неделе («база → черновик») переносятся на текущую
 * неделю; тип недели берётся из черновика, только если тренер его менял. Недели, которых нет в базе или в текущем плане, остаются как в черновике.
 */
export function rebaseBuilderWeeks(base: readonly BuilderWeek[], draft: readonly BuilderWeek[], current: readonly BuilderWeek[],
  newId: () => string): readonly BuilderWeek[] {
  const rebased = draft.map((week, at) => {
    const was = base[at];
    const now = current[at];
    if (was === undefined || now === undefined) return week;
    return { type: week.type !== was.type ? week.type : now.type, workouts: rebaseDraft(was.workouts, week.workouts, now.workouts, newId) };
  });
  // Тренер число недель не менял, а в мезоцикле их с тех пор стало больше: добавленные недели остаются (удалённые тренером — не возвращаются).
  return draft.length === base.length ? [...rebased, ...current.slice(draft.length)] : rebased;
}
