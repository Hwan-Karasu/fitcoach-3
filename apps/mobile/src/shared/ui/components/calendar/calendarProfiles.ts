import { addDays, CALENDAR_MIN_YEAR } from "./calendarRules.ts";

/**
 * Профили календаря (UI-OWN-094): готовые наборы настроек под задачу. Экран называет профиль, а не повторяет границы и режимы;
 * свои `min`/`max`/`title` в запросе перекрывают профиль. Чистый модуль: «сегодня» приходит параметром.
 */
export type CalendarProfileId = "birthDate" | "pastDate" | "anyDate" | "futureDate" | "nutritionDay" | "period";
export type CalendarView = "day" | "month" | "year";

export interface CalendarSettings {
  readonly mode: "single" | "range";
  /** С какого вида открывается: у даты рождения — с выбора года. */
  readonly startView: CalendarView;
  /** Дату можно набрать цифрами (карандаш) — только у даты рождения. */
  readonly typing: boolean;
  readonly showToday: boolean;
  readonly min?: string;
  readonly max?: string;
}

const single = { mode: "single", startView: "day", typing: false, showToday: true } as const;

export function profileSettings(id: CalendarProfileId, today: string): CalendarSettings {
  switch (id) {
    case "birthDate": return { ...single, startView: "year", typing: true, showToday: false, min: `${CALENDAR_MIN_YEAR}-01-01`, max: addDays(today, -1) };
    case "pastDate": return { ...single, max: today };
    case "futureDate": return { ...single, min: today };
    case "period": return { mode: "range", startView: "day", typing: false, showToday: false, max: today };
    case "anyDate":
    case "nutritionDay": return single;
  }
}

/** Дата, с которой открывается календарь рождения, пока значения нет: середина типичных годов клиентов. */
export const BIRTH_DATE_START = "1990-01-01";
