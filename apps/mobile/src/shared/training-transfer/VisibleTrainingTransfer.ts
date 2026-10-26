import type { TrainingTransfer, TransferWorkout } from "./TrainingTransfer.ts";

/** Old exports sometimes used an internal exercise ID as a display name. It is not recoverable content. */
export const isTechnicalExerciseName = (name: string): boolean => /^(?:exercise[_:][0-9a-f-]{16,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu.test(name.trim());

/** Current matrix only. Old versions and facts of removed rows cannot add rows to this snapshot. */
export function visibleTrainingTransfer(value: TrainingTransfer): TrainingTransfer {
  const names = new Map(value.exercises.filter((e) => e.name.trim() && !isTechnicalExerciseName(e.name)).map((e) => [e.id, e.name]));
  const used = new Set<string>();
  const workouts = (items: readonly TransferWorkout[]) => items.map((w) => ({ ...w, exercises: w.exercises.filter((e) => names.has(e.exerciseId)).map((e) => { used.add(e.exerciseId); return e; }) }));
  const programs = value.programs.filter((p) => p.simple || p.mesocycles.length).map((p) => ({ ...p,
    simple: p.simple ? { ...p.simple, workouts: workouts(p.simple.workouts) } : null,
    simpleWeeks: p.simpleWeeks.map((w) => ({ ...w, workouts: workouts(w.workouts) })),
    mesocycles: p.mesocycles.map((c) => ({ ...c, weeks: c.weeks.map((w) => ({ ...w, workouts: workouts(w.workouts) })) })) }));
  const slots = new Map<string, TransferWorkout>();
  const key = (program: string, week: number, workout: string) => JSON.stringify([program, week, workout]);
  for (const p of programs) {
    if (p.simple) for (let week = 1; week <= p.simple.weeks; week++) for (const w of p.simpleWeeks.find((w) => w.index === week)?.workouts ?? p.simple.workouts) slots.set(key(p.id, week, w.id), w);
    for (const c of p.mesocycles) for (const week of c.weeks) for (const w of week.workouts) slots.set(key(p.id, week.index, w.id), w);
  }
  const sessions = value.sessions.filter((s) => slots.has(key(s.programId, s.weekIndex, s.plannedWorkoutId))).map((s) => {
    const plan = slots.get(key(s.programId, s.weekIndex, s.plannedWorkoutId))!;
    const facts = s.facts.filter((f) => plan.exercises.some((e) => e.id === f.plannedExerciseId && e.exerciseId === f.exerciseId && (f.extra || e.sets.some((set) => set.id === f.plannedSetId))));
    return { ...s, facts, notes: s.notes.filter((n) => plan.exercises.some((e) => e.id === n.plannedExerciseId)) };
  });
  const targets = new Set([...programs.flatMap((p) => [...p.simple?.workouts ?? [], ...p.simpleWeeks.flatMap((w) => w.workouts), ...p.mesocycles.flatMap((c) => c.weeks.flatMap((w) => w.workouts))]).flatMap((w) => w.exercises.flatMap((e) => e.sets.map((s) => s.id))), ...sessions.flatMap((s) => s.facts.map((f) => f.id))]);
  return { ...value, programs, sessions, exercises: value.exercises.filter((e) => used.has(e.id)), planHistory: [], issues: value.issues?.filter((i) => targets.has(i.targetId)) };
}
