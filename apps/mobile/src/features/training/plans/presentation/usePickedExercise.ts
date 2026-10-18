import { useEffect, useRef } from "react";
import type { ExerciseInfo } from "../domain/ExerciseLookupPort.ts";
import { addExercises, replaceExercise } from "../domain/SimplePlanEdits.ts";
import type { SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { setFieldsOf } from "../domain/SimplePlanRules.ts";
import { newPlanId } from "./WorkoutsEditor.tsx";

/**
 * Упражнения, выбранные в каталоге (передаёт навигация), в порядке выбора (UI-OWN-029); `replace` — какое плановое
 * упражнение заменить (тогда выбрано одно).
 */
export type PickedExercise = Readonly<{ token: string; workoutId: string; exerciseIds: readonly string[]; replace?: string }>;

/** Выбранные в каталоге упражнения добавляются (или одно заменяет «⇄») один раз — по токену выбора. */
export function usePickedExercise(picked: PickedExercise | null, draft: SimpleProgramDraft | null,
  lookup: ReadonlyMap<string, ExerciseInfo> | null, change: (next: SimpleProgramDraft) => void): void {
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (picked === null || draft === null || lookup === null || applied.current === picked.token) return;
    applied.current = picked.token;
    const [first] = picked.exerciseIds;
    if (picked.replace === undefined) change(addExercises(draft, picked.workoutId, picked.exerciseIds, newPlanId));
    else if (first !== undefined) {
      change(replaceExercise(draft, picked.replace, newPlanId("e"), first, setFieldsOf(lookup.get(first)?.metrics ?? []),
        () => newPlanId("s")));
    }
  }, [change, draft, lookup, picked]);
}
