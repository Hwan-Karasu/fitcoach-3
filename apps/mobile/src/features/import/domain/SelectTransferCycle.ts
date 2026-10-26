import type { TrainingTransfer, TransferWorkout } from "../../../shared/training-transfer/TrainingTransfer.ts";

/** Select by stable cycle and workout identities, never by titles or calendar dates. */
export function selectTransferCycle(value: TrainingTransfer, programId: string, cycleId: string): TrainingTransfer {
  const program = value.programs.find((p) => p.id === programId);
  const cycle = program?.mesocycles.find((c) => c.id === cycleId);
  if (!program || !cycle) throw new Error("Цикл больше не доступен. Обновите программу.");
  const history = value.planHistory?.filter((h) => h.programId === programId && h.mesocycle?.id === cycleId) ?? [];
  const slot = (week: number, workout: string) => JSON.stringify([week, workout]);
  const slots = new Set(cycle.weeks.flatMap((w) => w.workouts.map((item) => slot(w.index, item.id))));
  for (const h of history) for (const week of h.mesocycle!.weeks) for (const workout of week.workouts) slots.add(slot(week.index, workout.id));
  const known = new Set(program.mesocycles.flatMap((c) => c.weeks.flatMap((w) => w.workouts.map((item) => slot(w.index, item.id)))));
  for (const h of value.planHistory?.filter((h) => h.programId === programId) ?? []) for (const w of h.mesocycle?.weeks ?? []) for (const item of w.workouts) known.add(slot(w.index, item.id));
  if (value.sessions.some((s) => s.programId === programId && !known.has(slot(s.weekIndex, s.plannedWorkoutId)))) throw new Error("Часть истории не привязана к циклам. Экспортируйте программу целиком, чтобы сохранить все результаты.");
  const sessions = value.sessions.filter((s) => s.programId === programId && slots.has(slot(s.weekIndex, s.plannedWorkoutId)));
  const used = new Set(sessions.flatMap((s) => s.facts.map((f) => f.exerciseId)));
  const collect = (workouts: readonly TransferWorkout[]) => workouts.forEach((w) => w.exercises.forEach((e) => used.add(e.exerciseId)));
  cycle.weeks.forEach((w) => collect(w.workouts)); history.forEach((h) => h.mesocycle!.weeks.forEach((w) => collect(w.workouts)));
  const targets = new Set([...cycle.weeks.flatMap((w) => w.workouts.flatMap((item) => item.exercises.flatMap((e) => e.sets.map((s) => s.id)))), ...sessions.flatMap((s) => s.facts.map((f) => f.id))]);
  return { ...value, programs: [{ ...program, mesocycles: [cycle] }], sessions, planHistory: history,
    exercises: value.exercises.filter((e) => used.has(e.id)), issues: value.issues?.filter((issue) => issue.programId === programId && targets.has(issue.targetId)) };
}
