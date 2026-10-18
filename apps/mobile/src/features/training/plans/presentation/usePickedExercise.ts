import { useEffect, useRef } from "react";
import type { ExerciseInfo } from "../domain/ExerciseLookupPort.ts";
import { addExercise, replaceExercise } from "../domain/SimplePlanEdits.ts";
import type { SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { setFieldsOf } from "../domain/SimplePlanRules.ts";
import { newPlanId } from "./WorkoutsEditor.tsx";

/** Упражнение, выбранное в каталоге (передаёт навигация); `replace` — какое плановое упражнение заменить. */
export type PickedExercise = Readonly<{ token: string; workoutId: string; exerciseId: string; replace?: string }>;

/** Выбранное в каталоге упражнение добавляется (или заменяет «⇄») один раз — по токену выбора. */
export function usePickedExercise(picked: PickedExercise | null, draft: SimpleProgramDraft | null,
  lookup: ReadonlyMap<string, ExerciseInfo> | null, change: (next: SimpleProgramDraft) => void): void {
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (picked === null || draft === null || lookup === null || applied.current === picked.token) return;
    applied.current = picked.token;
    const plannedId = newPlanId("e");
    change(picked.replace === undefined
      ? addExercise(draft, picked.workoutId, plannedId, picked.exerciseId, () => newPlanId("s"))
      : replaceExercise(draft, picked.replace, plannedId, picked.exerciseId, setFieldsOf(lookup.get(picked.exerciseId)?.metrics ?? []),
        () => newPlanId("s")));
  }, [change, draft, lookup, picked]);
}
