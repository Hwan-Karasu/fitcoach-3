import { formatDecimalX10, parseDecimalX10 } from "../domain/FoodRules.ts";
import { TARGET_METRICS, type Corridors, type TargetMetric } from "../domain/TargetModel.ts";

export interface RangeDraft { readonly min: string; readonly max: string }
export type CorridorDraft = Readonly<Record<TargetMetric, RangeDraft>>;

export const EMPTY_DRAFT: CorridorDraft = { kcal: { min: "", max: "" }, protein: { min: "", max: "" }, fat: { min: "", max: "" }, carbs: { min: "", max: "" } };

export const weekdayShort = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
export const weekdayFull = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"] as const;

export function draftOf(corridors: Corridors | null): CorridorDraft {
  if (corridors === null) return EMPTY_DRAFT;
  const field = (metric: TargetMetric): RangeDraft => {
    const range = corridors[metric];
    return range === null ? { min: "", max: "" } : { min: formatDecimalX10(range.minX10), max: formatDecimalX10(range.maxX10) };
  };
  return { kcal: field("kcal"), protein: field("protein"), fat: field("fat"), carbs: field("carbs") };
}

export const isEmptyDraft = (draft: CorridorDraft): boolean => TARGET_METRICS.every((metric) => draft[metric].min.trim() === "" && draft[metric].max.trim() === "");

/**
 * Черновик → коридоры. Пустая пара — показатель без цели (`null`); одна граница без другой, нечисло и `min > max` — текст ошибки
 * (порядок границ молча не меняется, §49.8.2).
 */
export function corridorsOf(draft: CorridorDraft, labels: Readonly<Record<TargetMetric, string>>): Corridors | string {
  const out = {} as Record<TargetMetric, { minX10: number; maxX10: number } | null>;
  for (const metric of TARGET_METRICS) {
    const { min, max } = draft[metric];
    if (min.trim() === "" && max.trim() === "") { out[metric] = null; continue; }
    if (min.trim() === "" || max.trim() === "") return `${labels[metric]}: задайте обе границы или очистите обе.`;
    const minX10 = parseDecimalX10(min);
    const maxX10 = parseDecimalX10(max);
    if (minX10 === null || maxX10 === null) return `${labels[metric]}: границы — числа, например 1900 или 12,5.`;
    if (minX10 > maxX10) return `${labels[metric]}: нижняя граница больше верхней — исправьте порядок.`;
    out[metric] = { minX10, maxX10 };
  }
  return out;
}
