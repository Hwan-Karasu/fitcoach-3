import { AppCalendar } from "./calendar/AppCalendar.tsx";
import { type DateRange } from "./calendar/calendarRules.ts";
import { todayLocal } from "./calendar/today.ts";

export type { DateRange };

/**
 * Календарь выбора диапазона дат (профиль «Период», UI-OWN-094): тот же `AppCalendar`, что и для одной даты. Первое нажатие — начало,
 * второе — конец (раньше начала — границы меняются местами); месяцы листаются свайпом, месяц и год — кнопки в шапке; будущее недоступно.
 */
export function DateRangeCalendar({ value, max, onChange }: Readonly<{
  value: DateRange;
  /** Последняя доступная дата, включительно. */
  max: string;
  onChange: (range: DateRange) => void;
}>) {
  return <AppCalendar mode="range" min="1920-01-01" max={max} today={todayLocal()} value={value} onChange={onChange} />;
}
