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
 * Дата после свайпа: дни — карусель без краёв (UIX-FIT-11), всегда соседние сутки от выбранного; за «Вчера» — позавчера,
 * за «Завтра» — послезавтра. Не `null` никогда: тип сохранён, чтобы вызывающий код не менялся.
 */
export function swipedDay(selected: string, _today: string, swipe: DaySwipeDirection): string | null {
  return shiftIsoDate(selected, swipe === "NEXT" ? 1 : -1);
}

/** Разница дат в сутках (`to` − `from`); считается по UTC-полуночам, часовой пояс и переход на летнее время не влияют. */
export function daysBetweenIso(from: string, to: string): number {
  const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const TAB_WORDS: Readonly<Record<number, string>> = { [-1]: "Вчера", 0: "Сегодня", 1: "Завтра" };

/** Подпись дня в карусели: слово — только для вчера/сегодня/завтра (от сегодняшней даты), дальше — дата `ДД.ММ.ГГГГ`. */
export function carouselLabel(date: string, today: string): string {
  return TAB_WORDS[daysBetweenIso(today, date)] ?? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** Пять соседних дней карусели вокруг выбранного: −2…+2. Видны три, крайние — для плавного въезда при смене дня. */
export const CAROUSEL_RADIUS = 2;
export function carouselSlots(selected: string, today: string): readonly Readonly<{ date: string; label: string }>[] {
  return Array.from({ length: CAROUSEL_RADIUS * 2 + 1 }, (_, index) => {
    const date = shiftIsoDate(selected, index - CAROUSEL_RADIUS);
    return { date, label: carouselLabel(date, today) };
  });
}
