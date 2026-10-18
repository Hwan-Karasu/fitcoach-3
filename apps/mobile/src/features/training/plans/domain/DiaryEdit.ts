import { addExercises, addSet, removeExercise, reorderExercises, replaceExercise, SETS_MAX } from "./SimplePlanEdits.ts";
import type { PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";
import type { SetField } from "./SimplePlanRules.ts";
import { applySupersetPress } from "./SupersetRules.ts";

/**
 * Правка плана тренировки прямо из дневника (UI-OWN-037, решение владельца «сразу на месте»): действие строит
 * новую тренировку, затем тренер выбирает область (§48.5 / §48.6). Факты не трогаются — у дневника свой владелец.
 */
export type DiaryEdit =
  | Readonly<{ kind: "remove"; exerciseId: string }>
  | Readonly<{ kind: "replace"; exerciseId: string; newExerciseId: string }>
  | Readonly<{ kind: "reorder"; order: readonly string[] }>
  | Readonly<{ kind: "superset"; exerciseIds: readonly string[] }>
  | Readonly<{ kind: "leaveSuperset"; exerciseId: string }>
  | Readonly<{ kind: "addExercises"; exerciseIds: readonly string[] }>
  | Readonly<{ kind: "addSet"; exerciseId: string }>;

/** Заголовок окна выбора области. */
export const diaryEditTitles: Readonly<Record<DiaryEdit["kind"], string>> = {
  remove: "Удалить упражнение", replace: "Заменить упражнение", reorder: "Изменить порядок", superset: "Объединить в суперсет",
  leaveSuperset: "Убрать из суперсета", addExercises: "Добавить упражнения", addSet: "Добавить подход",
};

export function applyDiaryEdit(workout: PlannedWorkout, edit: DiaryEdit, newId: (prefix: string) => string,
  fieldsOf: (exerciseId: string) => readonly SetField[]): PlannedWorkout {
  const draft: SimpleProgramDraft = { title: workout.title, plan: { weeks: 1, workouts: [workout] } };
  const next = ((): SimpleProgramDraft => {
    switch (edit.kind) {
      case "remove": return removeExercise(draft, edit.exerciseId);
      case "replace": return replaceExercise(draft, edit.exerciseId, newId("e"), edit.newExerciseId, fieldsOf(edit.newExerciseId),
        () => newId("s"));
      case "reorder": return reorderExercises(draft, workout.id, edit.order);
      case "superset": return applySupersetPress(draft, workout.id, { type: "commit", ids: edit.exerciseIds });
      case "leaveSuperset": return applySupersetPress(draft, workout.id, { type: "extract", id: edit.exerciseId });
      case "addExercises": return addExercises(draft, workout.id, edit.exerciseIds, newId);
      case "addSet": {
        const count = workout.exercises.find((item) => item.id === edit.exerciseId)?.sets.length ?? SETS_MAX;
        return count >= SETS_MAX ? draft : addSet(draft, edit.exerciseId, newId("s"));
      }
    }
  })();
  return next.plan.workouts[0] ?? workout;
}
