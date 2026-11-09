/** Выбранный день клиента (UIX-05, UI-OWN-070): вкладки «Вчера | Сегодня | Завтра» и будущий день. Даты — локальные `YYYY-MM-DD`. */
export type DayTab = "YESTERDAY" | "TODAY" | "TOMORROW";

const TAB_OFFSET: Readonly<Record<DayTab, number>> = { YESTERDAY: -1, TODAY: 0, TOMORROW: 1 };

export function shiftIsoDate(date: string, days: number): string {
  const value = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days));
  return value.toISOString().slice(0, 10);
}

export function dateOfTab(tab: DayTab, today: string): string {
  return shiftIsoDate(today, TAB_OFFSET[tab]);
}

/** Какая вкладка соответствует выбранной дате; другая дата — `null` (выбрана в календаре). */
export function dayTabOf(selected: string, today: string): DayTab | null {
  return (Object.keys(TAB_OFFSET) as DayTab[]).find((tab) => dateOfTab(tab, today) === selected) ?? null;
}

/** Для будущего дня доступно только питание: вес, шаги и тренировка приглушены. */
export function isFutureDay(selected: string, today: string): boolean {
  return selected > today;
}
