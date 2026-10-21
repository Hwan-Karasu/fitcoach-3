import type { EatenEntry } from "./DiaryModel.ts";
import { accountedDates, assertDate, summarizeDay } from "./DiaryRules.ts";
import { TARGET_METRICS, type Corridors, type RangeVerdict, type ResolvedTarget, type TargetException, type TargetMetric, type TargetRange, type TargetVersion } from "./TargetModel.ts";
import { assessDay, hasAnyRange, NUTRIENT_OF, resolveTarget } from "./TargetRules.ts";

/** Один день периода: учтён ли он (есть пищевая запись), значения по записям и оценка по коридору этой даты. */
export interface NutritionDayPoint {
  readonly localDate: string;
  /** П15=B: день с учётом — есть хотя бы одна пищевая запись; вода и пустой день сюда не входят (§49.22.1). */
  readonly accounted: boolean;
  /** Сумма внесённого; `null` — день не учтён или показатель неизвестен (не ноль). */
  readonly valuesX10: Readonly<Record<TargetMetric, number | null>>;
  readonly verdicts: Readonly<Record<TargetMetric, RangeVerdict>>;
  readonly targetSource: "EXCEPTION" | "SCHEDULE" | "NONE";
  /** Коридор дня по показателям — для линии цели на графике. */
  readonly ranges: Readonly<Record<TargetMetric, TargetRange | null>>;
}

export interface MetricStats {
  /** Среднее по учтённым дням с известным значением показателя, десятые доли; `null` — таких дней нет. */
  readonly averageX10: number | null;
  /** Знаменатель среднего. */
  readonly daysWithValue: number;
  readonly below: number;
  readonly inRange: number;
  readonly above: number;
  /** Знаменатель доли попаданий: учтённые дни с известным значением и действовавшим коридором показателя. */
  readonly compared: number;
  /** Доля попаданий в процентах×10 (`625` = 62,5 %); `null` при нулевом знаменателе — показываем «—», а не «0 %» (§49.22.1.5). */
  readonly hitPercentX10: number | null;
}

export interface NutritionStats {
  readonly from: string;
  readonly to: string;
  readonly periodDays: number;
  /** Знаменатель средних — число учтённых дней, а не дней периода (§49.22.2). */
  readonly accountedDays: number;
  readonly metrics: Readonly<Record<TargetMetric, MetricStats>>;
  /** Все даты периода по порядку: общий знаменатель для графиков и таблиц. */
  readonly days: readonly NutritionDayPoint[];
}

export interface NutritionStatsInput {
  /** Цель дня из расчёта и ручной корректировки (ADR-029); без неё действует только сохранённое расписание версий. Пустые коридоры — «цели нет». */
  readonly corridorsFor?: (localDate: string, resolved: ResolvedTarget) => Corridors;
  /** All-time query: keep only accounted dates in days; the denominator still covers the full interval. */
  readonly sparse?: boolean;
  readonly from: string;
  readonly to: string;
  readonly entries: readonly EatenEntry[];
  readonly versions: readonly TargetVersion[];
  readonly exceptions: readonly TargetException[];
}

function withCorridors(resolved: ResolvedTarget, localDate: string, corridors: Corridors): ResolvedTarget {
  if (!hasAnyRange(corridors)) return { source: "NONE" };
  return resolved.source === "EXCEPTION" ? resolved : { source: "SCHEDULE", effectiveFrom: resolved.source === "SCHEDULE" ? resolved.effectiveFrom : localDate, corridors };
}

/** Не больше пяти лет: защита от случайного бесконечного периода. */
const MAX_DAYS = 366 * 5;

function datesBetween(from: string, to: string): readonly string[] {
  assertDate(from);
  assertDate(to);
  if (to < from) throw new Error("STATS_PERIOD_INVALID");
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  for (; cursor.toISOString().slice(0, 10) <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (dates.length >= MAX_DAYS) throw new Error("STATS_PERIOD_INVALID");
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Статистика питания по внесённым записям (§49.22, N04): средние по дням с учётом и доля попаданий в коридор, действовавший на дату.
 * Интерпретация — «по записям дневника», не доказанное полное потребление; пустые даты и дни только с водой не входят ни в средние, ни в доли.
 * Показатель с неизвестным значением исключается из своего среднего и сравнения, но не из других показателей дня.
 */
export function computeNutritionStats(input: NutritionStatsInput): NutritionStats {
  assertDate(input.from); assertDate(input.to);
  if (input.to < input.from) throw new Error("STATS_PERIOD_INVALID");
  const inPeriod = input.entries.filter((entry) => entry.localDate >= input.from && entry.localDate <= input.to);
  const dates = input.sparse ? accountedDates(inPeriod) : datesBetween(input.from, input.to);
  const byDate = new Map<string, EatenEntry[]>();
  for (const entry of inPeriod) {
    const rows = byDate.get(entry.localDate);
    if (rows === undefined) byDate.set(entry.localDate, [entry]); else rows.push(entry);
  }
  const accounted = new Set(accountedDates(inPeriod));
  const days: NutritionDayPoint[] = dates.map((localDate) => {
    const resolved = resolveTarget(input.versions, input.exceptions, localDate);
    const target = input.corridorsFor === undefined ? resolved : withCorridors(resolved, localDate, input.corridorsFor(localDate, resolved));
    const summary = summarizeDay(localDate, byDate.get(localDate) ?? []);
    const isAccounted = accounted.has(localDate);
    const verdicts = isAccounted ? assessDay(summary, target)
      : { kcal: "UNKNOWN", protein: "UNKNOWN", fat: "UNKNOWN", carbs: "UNKNOWN" } as const;
    const valuesX10 = Object.fromEntries(TARGET_METRICS.map((metric) => [metric, isAccounted ? summary.totals[NUTRIENT_OF[metric]] : null])) as Record<TargetMetric, number | null>;
    const ranges = Object.fromEntries(TARGET_METRICS.map((metric) => [metric, target.source === "NONE" ? null : target.corridors[metric]])) as Record<TargetMetric, TargetRange | null>;
    return { localDate, accounted: isAccounted, valuesX10, verdicts, targetSource: target.source, ranges };
  });
  const metrics = Object.fromEntries(TARGET_METRICS.map((metric) => {
    const values = days.flatMap((day) => day.valuesX10[metric] === null ? [] : [day.valuesX10[metric] as number]);
    const verdicts = days.map((day) => day.verdicts[metric]);
    const count = (verdict: RangeVerdict) => verdicts.filter((item) => item === verdict).length;
    const [below, inRange, above] = [count("BELOW"), count("IN"), count("ABOVE")];
    const compared = below + inRange + above;
    return [metric, { averageX10: values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      daysWithValue: values.length, below, inRange, above, compared, hitPercentX10: compared === 0 ? null : Math.round((inRange * 1000) / compared) } satisfies MetricStats];
  })) as Record<TargetMetric, MetricStats>;
  const periodDays = Math.round((Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86400000) + 1;
  return { from: input.from, to: input.to, periodDays, accountedDays: accounted.size, metrics, days };
}

/** Средняя цель по показателю за период: середина коридора, усреднённая по учтённым дням с целью. Нет целей — `null`. Десятые доли. */
export function averageTargetX10(days: readonly NutritionDayPoint[], metric: TargetMetric): number | null {
  const middles = days.flatMap((day) => day.accounted && day.ranges[metric] !== null ? [(day.ranges[metric]!.minX10 + day.ranges[metric]!.maxX10) / 2] : []);
  return middles.length === 0 ? null : Math.round(middles.reduce((sum, value) => sum + value, 0) / middles.length);
}
