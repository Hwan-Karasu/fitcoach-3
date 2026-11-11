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

/** Направление свайпа по дням: «вперёд» — к завтрашнему дню (палец влево), «назад» — к вчерашнему (палец вправо). */
export type DaySwipeDirection = "NEXT" | "PREV";

/** Порог сдвига пальца, dp, и скорость, dp/с, после которых горизонтальное движение считается свайпом по дням. */
export const DAY_SWIPE_DISTANCE = 56;
export const DAY_SWIPE_VELOCITY = 650;

/** Свайп или нет и в какую сторону (палец влево — «вперёд»). */
export function daySwipeOf(translationX: number, velocityX: number): DaySwipeDirection | null {
  "worklet";
  const far = Math.abs(translationX) >= DAY_SWIPE_DISTANCE;
  const fast = Math.abs(velocityX) >= DAY_SWIPE_VELOCITY && Math.abs(translationX) >= 12;
  if (!far && !fast) return null;
  // Решает знак сдвига; при сомнении (сдвиг мал, но скорость велика) — знак скорости.
  const direction = Math.abs(translationX) >= 12 ? translationX : velocityX;
  return direction < 0 ? "NEXT" : "PREV";
}

/**
 * Дата после свайпа. Внутри вкладок «Вчера · Сегодня · Завтра» — на соседнюю вкладку; с краёв (назад от «Вчера», вперёд от «Завтра») —
 * `null`, день не меняется. Если дата выбрана в календаре (вне вкладок) — сдвиг на сутки.
 */
export function swipedDay(selected: string, today: string, swipe: DaySwipeDirection): string | null {
  const step = swipe === "NEXT" ? 1 : -1;
  const tab = dayTabOf(selected, today);
  if (tab === null) return shiftIsoDate(selected, step);
  const next = TAB_OFFSET[tab] + step;
  return next < -1 || next > 1 ? null : shiftIsoDate(today, next);
}
