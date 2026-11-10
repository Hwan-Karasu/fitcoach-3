import type { DailyPoint } from "./MeasurementModel.ts";

/** Показатели ряда замеров за период (UIX-09, UI-OWN-075); значения в десятых долях единицы, как в хранилище. */
export interface PointStats {
  /** Дни с одним определённым значением (основным или единственным). */
  readonly count: number;
  /** Дни, где несколько записей без выбранной основной: в расчёт не входят и не усредняются. */
  readonly ambiguousDays: number;
  /** Первое и последнее значение периода; `null` — значений нет. */
  readonly startX10: number | null;
  readonly nowX10: number | null;
  /** «Сейчас» минус «Начало»; `null` — меньше двух дней со значением (изменение неизвестно, а не ноль). */
  readonly changeX10: number | null;
  /** Среднее по дням со значением, округлённое до десятой. */
  readonly averageX10: number | null;
  readonly minX10: number | null;
  readonly maxX10: number | null;
}

/** Свод по дневным точкам, упорядоченным по возрастанию даты; неоднозначные дни не заменяются средним и не подставляются. */
export function statsOfPoints(points: readonly DailyPoint[]): PointStats {
  const values = points.flatMap((point) => point.kind === "VALUE" ? [point.measurement.valueX10] : []);
  const ambiguousDays = points.length - values.length;
  if (values.length === 0) return { count: 0, ambiguousDays, startX10: null, nowX10: null, changeX10: null, averageX10: null, minX10: null, maxX10: null };
  const startX10 = values[0]!;
  const nowX10 = values[values.length - 1]!;
  return { count: values.length, ambiguousDays, startX10, nowX10, changeX10: values.length < 2 ? null : nowX10 - startX10,
    averageX10: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), minX10: Math.min(...values), maxX10: Math.max(...values) };
}
