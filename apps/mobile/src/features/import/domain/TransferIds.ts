import type { TrainingTransfer, TransferWorkout } from "../../../shared/training-transfer/TrainingTransfer.ts";

/**
 * Новые идентификаторы для импортируемой книги. Каждый исходный ID получает один новый (одинаковый везде, где встречается:
 * в плане, истории структуры и результатах), поэтому связи сохраняются. Хешей нет: новые ID выдаёт вызывающий (случайные UUID),
 * а повторный импорт той же книги создаёт новую программу.
 */
type Rewrite = Readonly<{ id: (source: string) => string; exercise: (source: string) => string }>;

function rewrite(value: TrainingTransfer, clientId: string, r: Rewrite): TrainingTransfer {
  const { id, exercise } = r;
  const workouts = (items: readonly TransferWorkout[]) => items.map((w) => ({ ...w, id: id(w.id), ...(w.lineageId ? { lineageId: id(w.lineageId) } : {}),
    exercises: w.exercises.map((e) => ({ ...e, id: id(e.id), exerciseId: exercise(e.exerciseId), ...(e.lineageId ? { lineageId: id(e.lineageId) } : {}),
      ...(e.supersetId ? { supersetId: id(e.supersetId) } : {}), sets: e.sets.map((s) => ({ ...s, id: id(s.id) })) })) }));
  return { ...value, client: { ...value.client, id: clientId }, exercises: value.exercises.map((e) => ({ ...e, id: exercise(e.id) })),
    ...(value.planHistory ? { planHistory: value.planHistory.map((h) => ({ ...h, id: id(h.id), programId: id(h.programId),
      simple: h.simple ? { ...h.simple, weeks: h.simple.weeks.map((w) => ({ ...w, workouts: workouts(w.workouts) })) } : null,
      mesocycle: h.mesocycle ? { ...h.mesocycle, id: id(h.mesocycle.id), lineageId: id(h.mesocycle.lineageId),
        weeks: h.mesocycle.weeks.map((w) => ({ ...w, id: id(w.id), workouts: workouts(w.workouts) })) } : null })) } : {}),
    programs: value.programs.map((p) => ({ ...p, id: id(p.id), simple: p.simple ? { ...p.simple, workouts: workouts(p.simple.workouts) } : null,
      simpleWeeks: p.simpleWeeks.map((w) => ({ ...w, workouts: workouts(w.workouts) })),
      mesocycles: p.mesocycles.map((c) => ({ ...c, id: id(c.id), lineageId: id(c.lineageId),
        weeks: c.weeks.map((w) => ({ ...w, id: id(w.id), workouts: workouts(w.workouts) })) })) })),
    sessions: value.sessions.map((s) => ({ ...s, id: id(s.id), programId: id(s.programId), plannedWorkoutId: id(s.plannedWorkoutId),
      facts: s.facts.map((f) => ({ ...f, id: id(f.id), plannedSetId: id(f.plannedSetId), plannedExerciseId: id(f.plannedExerciseId), exerciseId: exercise(f.exerciseId) })),
      notes: s.notes.map((n) => ({ ...n, plannedExerciseId: id(n.plannedExerciseId) })) })) };
}

/** Все исходные ID книги без повторов, в порядке первого появления: столько новых UUID нужно выдать. */
export function transferSourceIds(value: TrainingTransfer): readonly string[] {
  const seen = new Set<string>();
  rewrite(value, value.client.id, { id: (source) => { seen.add(source); return source; }, exercise: (source) => source });
  return [...seen];
}

/** Копия книги с новыми ID (`newIds`: исходный → новый), упражнениями из сопоставления и клиентом `clientId`. Вход не меняется. */
export function reidTransfer(value: TrainingTransfer, clientId: string, mapping: Readonly<Record<string, string>>,
  newIds: ReadonlyMap<string, string>): TrainingTransfer {
  return rewrite(value, clientId, {
    id: (source) => { const made = newIds.get(source); if (made === undefined) throw new Error(`Нет нового идентификатора для ${source}`); return made; },
    exercise: (source) => { const target = mapping[source]; if (!target) throw new Error("Сопоставьте все упражнения перед импортом."); return target; },
  });
}
