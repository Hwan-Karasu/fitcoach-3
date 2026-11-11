import type { DailyPoint } from "./MeasurementModel.ts";

/** Показатели ряда замеров за период (UIX-09, UI-OWN-075); значения в десятых долях единицы, как в хранилище. */
export interface PointStats {
  /** Дни с одним определённым значением (основным или единственным). */
  readonly count: number;
  /** Дни, где несколько записей без выбранной основной: в расчёт не входят и не усредняются. */
  readonly ambiguousDays: number;
  /** Первое и последнее значение периода; `null` — значений нет. */
  readonly startX100: number | null;
  readonly nowX100: number | null;
  /** «Сейчас» минус «Начало»; `null` — меньше двух дней со значением (изменение неизвестно, а не ноль). */
  readonly changeX100: number | null;
  /** Среднее по дням со значением, округлённое до десятой. */
  readonly averageX100: number | null;
  readonly minX100: number | null;
  readonly maxX100: number | null;
}

/** Свод по дневным точкам, упорядоченным по возрастанию даты; неоднозначные дни не заменяются средним и не подставляются. */
export function statsOfPoints(points: readonly DailyPoint[]): PointStats {
  const values = points.flatMap((point) => point.kind === "VALUE" ? [point.measurement.valueX100] : []);
  const ambiguousDays = points.length - values.length;
  if (values.length === 0) return { count: 0, ambiguousDays, startX100: null, nowX100: null, changeX100: null, averageX100: null, minX100: null, maxX100: null };
  const startX100 = values[0]!;
  const nowX100 = values[values.length - 1]!;
  return { count: values.length, ambiguousDays, startX100, nowX100, changeX100: values.length < 2 ? null : nowX100 - startX100,
    averageX100: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), minX100: Math.min(...values), maxX100: Math.max(...values) };
}
