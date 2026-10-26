import type { TransferWorkout } from "../../../shared/training-transfer/TrainingTransfer.ts";
import type { TransferReviewScope } from "./TrainingTransferReview.ts";

/** Copy into a new draft: preserve values, grouping and lineage, never reuse persisted IDs. */
export function copyWorkbookPlan(scope: TransferReviewScope, mapping: Readonly<Record<string, string>>, newId: () => string) {
  if (!scope.weeks.length || !scope.weeks.some((w) => w.workouts.some((item) => item.exercises.length))) throw new Error("На листе нет плана тренировок.");
  const lineage = new Map<string, string>();
  const related = (kind: string, id: string) => { const key = JSON.stringify([kind, id]); let value = lineage.get(key); if (!value) { value = newId(); lineage.set(key, value); } return value; };
  return { title: scope.title, settings: scope.settings, weeks: scope.weeks.map((week) => ({ type: week.type ?? "base",
    workouts: week.workouts.map((w): TransferWorkout => ({ ...w, id: newId(), lineageId: related("workout", w.lineageId ?? w.id),
      exercises: w.exercises.map((e) => {
        const exerciseId = mapping[e.exerciseId]; if (!exerciseId) throw new Error("Сопоставьте все упражнения листа с каталогом.");
        return { ...e, id: newId(), lineageId: related("exercise", e.lineageId ?? e.id), exerciseId,
          ...(e.supersetId ? { supersetId: related(`superset:${w.lineageId ?? w.id}`, e.supersetId) } : {}), sets: e.sets.map((s) => ({ ...s, id: newId() })) };
      }) })) })) };
}

/** A simple builder repeats one week; reject lossy conversion of a varying weekly plan. */
export function hasRepeatedWorkbookWeeks(weeks: readonly { readonly workouts: readonly TransferWorkout[] }[]): boolean {
  const shape = (workouts: readonly TransferWorkout[]) => JSON.stringify(workouts.map((w) => {
    const groups = new Map<string, number>();
    return { title: w.title, exercises: w.exercises.map((e) => {
      if (e.supersetId && !groups.has(e.supersetId)) groups.set(e.supersetId, groups.size);
      return { exerciseId: e.exerciseId, restSec: e.restSec, instruction: e.instruction, rir: e.rir, group: e.supersetId ? groups.get(e.supersetId) : null,
        sets: e.sets.map((s) => ({ reps: s.reps, repsMax: s.repsMax, loadGrams: s.loadGrams, durationSec: s.durationSec, distanceM: s.distanceM })) };
    }) };
  }));
  return weeks.every((w) => shape(w.workouts) === shape(weeks[0]?.workouts ?? []));
}
