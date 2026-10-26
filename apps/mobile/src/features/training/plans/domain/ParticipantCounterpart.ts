import type { Mesocycle } from "./PeriodizedModel.ts";
import type { GroupCopy } from "./Placement.ts";

/**
 * P01: переключение между независимыми циклами, явно прикреплёнными к группе навигации.
 */

/** Порядок в переключателе: клиент, с которого открыта программа, — первым, остальные — в порядке группы. */
export function participantOrder(members: readonly string[], anchorClientId: string): readonly string[] {
  return members.includes(anchorClientId) ? [anchorClientId, ...members.filter((id) => id !== anchorClientId)] : members;
}

/**
 * Показывать ли переключатель для мезоцикла `mesocycleId`: состав `members` относится именно к нему (среди копий есть
 * этот мезоцикл) и участников двое или больше. Состав, прочитанный для другого мезоцикла, не показывается.
 */
export function isGroupOfMesocycle(members: readonly GroupCopy[], mesocycleId: string): boolean {
  return members.length >= 2 && members.some((copy) => copy.mesocycleId === mesocycleId);
}

export type CounterpartRef = Readonly<{ mesocycleId: string | null; weekIndex: number; workoutId: string | null }>;

/**
 * Только прикреплённый цикл, точный номер недели и порядковый номер тренировки.
 * Отсутствующая позиция возвращает null: другой цикл или последняя неделя не подставляются.
 */
export function counterpartOf(from: readonly Mesocycle[], to: readonly Mesocycle[], toSelected: string | null,
  ref: CounterpartRef): Readonly<{ mesocycleId: string | null; weekIndex: number; workoutId: string | null }> | null {
  const source = from.find((cycle) => cycle.id === ref.mesocycleId)
    ?? from.find((cycle) => cycle.weeks.some((week) => week.workouts.some((workout) => workout.id === ref.workoutId)));
  const target = to.find((cycle) => cycle.id === toSelected);
  if (source === undefined || target === undefined) return null;
  if (ref.workoutId === null) return { mesocycleId: target.id, weekIndex: ref.weekIndex, workoutId: null };
  const sourceWeek = source.weeks.find((week) => week.index === ref.weekIndex);
  const position = sourceWeek?.workouts.findIndex((workout) => workout.id === ref.workoutId) ?? -1;
  const match = position < 0 ? undefined : target.weeks.find((week) => week.index === ref.weekIndex)?.workouts[position];
  return match === undefined ? null : { mesocycleId: target.id, weekIndex: ref.weekIndex, workoutId: match.id };
}
