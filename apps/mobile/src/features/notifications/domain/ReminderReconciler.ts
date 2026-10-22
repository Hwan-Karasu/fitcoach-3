import type { ReminderIntent } from "./ReminderPlanner.ts";

/** Только напоминания FitCoach начинаются с этого префикса: чужие и таймер отдыха reconcile не трогает. */
export const REMINDER_PREFIX = "fc-reminder:";
/** Android держит ограниченное число будильников на приложение (около 500): планируем ближайшее окно и не больше этого числа. */
export const SCHEDULE_HORIZON_DAYS = 14;
export const SCHEDULE_LIMIT = 200;

function hash(text: string): string {
  let value = 5381;
  for (let index = 0; index < text.length; index += 1) value = ((value * 33) ^ text.charCodeAt(index)) >>> 0;
  return value.toString(36);
}

/** Меняется вместе со временем, названием и текстом: правка записи заменяет напоминание, а не дублирует его. */
export function reminderIdentifier(intent: ReminderIntent): string {
  return `${REMINDER_PREFIX}${intent.sourceType}:${intent.sourceId}:${intent.fireAt.getTime()}:${hash(`${intent.title}|${intent.body}`)}`;
}

/** Ближайшие напоминания в пределах окна и лимита (по порядку срабатывания). */
export function withinHorizon(intents: readonly ReminderIntent[], now: Date): readonly ReminderIntent[] {
  const until = now.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  return intents.filter((intent) => intent.fireAt.getTime() <= until).slice(0, SCHEDULE_LIMIT);
}

export interface ScheduleDiff {
  readonly toCancel: readonly string[];
  readonly toSchedule: readonly ReminderIntent[];
}

/**
 * Разница между нужным набором и тем, что уже стоит в ОС. Идемпотентна: повторный запуск с тем же состоянием ничего не меняет;
 * устаревшие, отменённые и дублирующиеся FitCoach-напоминания снимаются.
 */
export function diffSchedule(desired: readonly ReminderIntent[], scheduledIds: readonly string[]): ScheduleDiff {
  const wanted = new Map(desired.map((intent) => [reminderIdentifier(intent), intent]));
  const mine = scheduledIds.filter((id) => id.startsWith(REMINDER_PREFIX));
  const present = new Set(mine);
  return {
    toCancel: mine.filter((id) => !wanted.has(id)),
    toSchedule: [...wanted].filter(([id]) => !present.has(id)).map(([, intent]) => intent),
  };
}
