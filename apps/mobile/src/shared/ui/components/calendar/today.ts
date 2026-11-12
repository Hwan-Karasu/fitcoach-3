import { isoOf } from "./calendarRules.ts";

/** Сегодняшняя дата по местному времени, `YYYY-MM-DD` (время — параметр, чтобы проверять в тестах). */
export function todayLocal(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
