import type { Mesocycle } from "./PeriodizedModel.ts";

/**
 * Переключатель участников (UI-OWN-043, как в 2.0): порядок и соответствие планов. У каждого участника своя копия
 * мезоциклов (§48.28), связь между копиями — родство (`lineageId`).
 */

/** Порядок в переключателе: клиент, с которого открыта программа, — первым, остальные — в порядке группы. */
export function participantOrder(members: readonly string[], anchorClientId: string): readonly string[] {
  return members.includes(anchorClientId) ? [anchorClientId, ...members.filter((id) => id !== anchorClientId)] : members;
}

export type CounterpartRef = Readonly<{ mesocycleId: string | null; weekIndex: number; workoutId: string | null }>;

/**
 * Где у другого участника то же место плана: мезоцикл того же родства (иначе — его выбранный/первый), та же
 * неделя, тренировка того же родства (иначе — на той же позиции в неделе). Тренировки нет — `workoutId: null`.
 */
export function counterpartOf(from: readonly Mesocycle[], to: readonly Mesocycle[], toSelected: string | null,
  ref: CounterpartRef): Readonly<{ mesocycleId: string | null; weekIndex: number; workoutId: string | null }> {
  const source = from.find((cycle) => cycle.id === ref.mesocycleId)
    ?? from.find((cycle) => cycle.weeks.some((week) => week.workouts.some((workout) => workout.id === ref.workoutId)));
  const target = (source === undefined ? undefined : to.find((cycle) => cycle.lineageId === source.lineageId))
    ?? to.find((cycle) => cycle.id === toSelected) ?? to[0];
  if (target === undefined) return { mesocycleId: null, weekIndex: ref.weekIndex, workoutId: null };
  const week = target.weeks.find((item) => item.index === ref.weekIndex);
  const weekIndex = week?.index ?? Math.min(ref.weekIndex, target.weeks.length);
  if (ref.workoutId === null || week === undefined || source === undefined) return { mesocycleId: target.id, weekIndex, workoutId: null };
  const sourceWeek = source.weeks.find((item) => item.index === ref.weekIndex);
  const position = sourceWeek?.workouts.findIndex((workout) => workout.id === ref.workoutId) ?? -1;
  const original = sourceWeek?.workouts[position];
  const lineage = original === undefined ? null : original.lineageId ?? original.id;
  const match = week.workouts.find((workout) => (workout.lineageId ?? workout.id) === lineage) ?? week.workouts[position];
  return { mesocycleId: target.id, weekIndex, workoutId: match?.id ?? null };
}
