import { isCalendarDay } from "../../../../shared/format/calendarDay.ts";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** `2026-10-17` → «17 окт»; неизвестная дата — «Дата неизвестна». */
export function shortDate(date: string | null): string {
  if (!isCalendarDay(date)) return "Дата неизвестна";
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ""}`;
}

/**
 * Подпись чипа даты в шапке дневника: неизвестная дата — короткое «Без даты», чтобы чип не вытеснял статус на вторую строку
 * (высота шапки при переключении недель должна быть одинаковой, иначе прокрутка «прыгает»).
 */
export function diaryDateChip(date: string | null): string {
  return isCalendarDay(date) ? shortDate(date) : "Без даты";
}
