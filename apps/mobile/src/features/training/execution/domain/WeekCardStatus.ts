import type { SessionStatus, WeekStatus, WorkoutStatus } from "./ExecutionModel.ts";
import { weekStatus } from "./ExecutionRules.ts";

/** Состояние карточки недели в ленте: «Пусто», «Текущая» (первая не закрытая) или статус недели. */
export type WeekCardState = WeekStatus | "EMPTY" | "CURRENT";

export interface WeekCardStates {
  /** Первая не закрытая неделя; если закрыты все — номер, равный числу недель (прежнее поведение панели программы). */
  readonly firstOpen: number;
  readonly states: ReadonlyMap<number, WeekCardState>;
}

/** Состояния карточек недель по статусам тренировок; тренировка без занятия — «не начата» (общая для панели программы и дневника). */
export function weekCardStates(weeks: readonly Readonly<{ index: number; workoutIds: readonly string[] }>[],
  statuses: readonly SessionStatus[]): WeekCardStates {
  const byKey = new Map(statuses.map((item) => [`${item.weekIndex}:${item.plannedWorkoutId}`, item.status]));
  const statusOf = (week: number, workoutId: string): WorkoutStatus => byKey.get(`${week}:${workoutId}`) ?? "NOT_STARTED";
  const own = new Map(weeks.map((week) => [week.index, weekStatus(week.workoutIds.map((id) => statusOf(week.index, id)))]));
  const firstOpen = weeks.find((week) => { const status = own.get(week.index); return status === "NOT_STARTED" || status === "IN_PROGRESS"; })?.index
    ?? weeks.length;
  return { firstOpen, states: new Map(weeks.map((week): [number, WeekCardState] => [week.index,
    week.workoutIds.length === 0 ? "EMPTY" : week.index === firstOpen ? "CURRENT" : own.get(week.index)!])) };
}

/** Смысл цвета карточки недели; сам цвет подбирает экран по токенам темы. */
export type WeekTone = "success" | "info" | "warning" | "accent" | "neutral";

/** Завершена — зелёный, в работе — синий, закрыта с отклонениями — янтарный (как у статусов тренировок), текущая — акцент темы. */
export function weekCardTone(state: WeekCardState): WeekTone {
  switch (state) {
    case "COMPLETED": return "success";
    case "IN_PROGRESS": return "info";
    case "CLOSED_WITH_DEVIATIONS": return "warning";
    case "CURRENT": return "accent";
    default: return "neutral";
  }
}
