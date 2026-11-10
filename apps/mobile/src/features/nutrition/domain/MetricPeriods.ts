import { shiftIsoDate } from "./DayNavigation.ts";

/**
 * Периоды экранов показателей «Шаги / Сон / Расход / Приёмы» (UIX-08, UI-OWN-075): масштабы «День | Неделя | Месяц | Период»,
 * навигатор периода и свод значений по дням. Даты — локальные `YYYY-MM-DD`; неделя — понедельник–воскресенье.
 */
export type MetricScale = "DAY" | "WEEK" | "MONTH" | "PERIOD";

export interface DateSpan {
  readonly from: string;
  readonly to: string;
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;
const MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."] as const;

const parts = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) });
const pad = (value: number, width = 2) => String(value).padStart(width, "0");
const iso = (year: number, month: number, day: number) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** Понедельник недели, в которую входит дата. */
export function mondayOf(date: string): string {
  const { year, month, day } = parts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftIsoDate(date, -((weekday + 6) % 7));
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Закрытый интервал дат масштаба вокруг опорной даты. «Период» — выбранный интервал; не выбран — неделя опорной даты. */
export function spanOf(scale: MetricScale, anchor: string, custom: DateSpan | null = null): DateSpan {
  if (scale === "DAY") return { from: anchor, to: anchor };
  if (scale === "WEEK" || (scale === "PERIOD" && custom === null)) { const from = mondayOf(anchor); return { from, to: shiftIsoDate(from, 6) }; }
  if (scale === "MONTH") {
    const { year, month } = parts(anchor);
    return { from: iso(year, month, 1), to: iso(year, month, lastDayOfMonth(year, month)) };
  }
  return custom as DateSpan;
}

/** Новая опорная дата при шаге навигатора: день ±1, неделя ±7 дней, месяц — первое число соседнего месяца. */
export function stepAnchor(scale: MetricScale, anchor: string, direction: -1 | 1): string {
  if (scale === "DAY") return shiftIsoDate(anchor, direction);
  if (scale === "WEEK" || scale === "PERIOD") return shiftIsoDate(anchor, 7 * direction);
  const { year, month } = parts(anchor);
  const index = year * 12 + (month - 1) + direction;
  return iso(Math.floor(index / 12), (index % 12) + 1, 1);
}

/** Все даты интервала по порядку; пустой или перевёрнутый интервал — пустой список. */
export function datesIn(span: DateSpan): readonly string[] {
  const result: string[] = [];
  for (let date = span.from; date <= span.to && result.length < 3700; date = shiftIsoDate(date, 1)) result.push(date);
  return result;
}

const dayMonth = (date: string) => `${parts(date).day} ${MONTHS_SHORT[parts(date).month - 1]}`;

/** Подпись навигатора: «10 нояб.», «9–15 нояб.», «Ноябрь 2026», «28 окт. – 5 нояб.». */
export function periodLabel(scale: MetricScale, span: DateSpan): string {
  if (scale === "MONTH") return `${MONTHS[parts(span.from).month - 1]} ${parts(span.from).year}`;
  if (span.from === span.to) return dayMonth(span.from);
  const a = parts(span.from);
  const b = parts(span.to);
  return a.month === b.month && a.year === b.year ? `${a.day}–${dayMonth(span.to)}` : `${dayMonth(span.from)} – ${dayMonth(span.to)}`;
}

/** Названия месяцев для листа выбора периода: последние `count` месяцев, считая от месяца опорной даты, новые сверху. */
export function recentMonths(anchor: string, count: number): readonly Readonly<{ anchor: string; label: string }>[] {
  const result: { anchor: string; label: string }[] = [];
  let current = spanOf("MONTH", anchor).from;
  for (let index = 0; index < count; index += 1) {
    result.push({ anchor: current, label: periodLabel("MONTH", spanOf("MONTH", current)) });
    current = stepAnchor("MONTH", current, -1);
  }
  return result;
}

export interface SeriesDay {
  readonly date: string;
  /** `null` — по дню нет данных (не ноль). */
  readonly value: number | null;
}

export interface SeriesSummary {
  readonly days: readonly SeriesDay[];
  /** Дни с известным значением — знаменатель среднего. */
  readonly known: number;
  readonly total: number;
  /** Среднее по дням с данными, округлённое; `null`, если данных нет. */
  readonly average: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

/** Ряд по дням интервала: неизвестные дни остаются «нет данных» и не входят в среднее, минимум и максимум. */
export function summarizeSeries(values: ReadonlyMap<string, number>, span: DateSpan, decimalPlaces = 0): SeriesSummary {
  const days = datesIn(span).map((date): SeriesDay => ({ date, value: values.get(date) ?? null }));
  const known = days.flatMap((day) => day.value === null ? [] : [day.value]);
  const total = known.reduce((sum, value) => sum + value, 0);
  const precision = 10 ** decimalPlaces;
  return { days, known: known.length, total, average: known.length === 0 ? null : Math.round(total / known.length * precision) / precision,
    min: known.length === 0 ? null : Math.min(...known), max: known.length === 0 ? null : Math.max(...known) };
}
