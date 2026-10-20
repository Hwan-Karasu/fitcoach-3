import { formatDecimalX10, parseDecimalX10 } from "./FoodRules.ts";
import type { TargetRange } from "./TargetModel.ts";

/**
 * Ввод цели одной ячейкой (UX 2.0): «22» — точное число (равные границы, §49.8.1.1), «22-30» — диапазон. Допустимы пробелы, запятая или точка, дефис, короткое и длинное тире.
 * Пусто — цели нет (`null`, не ноль); нечисловое, лишние части и `мин > макс` — `"invalid"`: порядок границ молча не меняется (§49.8.2).
 */
export function parseTargetText(text: string): TargetRange | null | "invalid" {
  // Пробелы допустимы только вокруг тире: «22 30» — не число 2230.
  const normalized = text.trim().replace(/\s*([-–—])\s*/gu, "$1");
  if (normalized === "") return null;
  if (/\s/u.test(normalized)) return "invalid";
  const parts = normalized.split(/[-–—]/u);
  if (parts.length > 2 || parts.some((part) => part === "")) return "invalid";
  const values = parts.map((part) => parseDecimalX10(part));
  if (values.some((value) => value === null)) return "invalid";
  const min = values[0] as number;
  const max = (values[1] ?? values[0]) as number;
  return min > max ? "invalid" : { minX10: min, maxX10: max };
}

/** Обратное преобразование для поля ввода: равные границы — одно число, иначе «мин-макс». */
export function formatTargetText(range: TargetRange | null): string {
  if (range === null) return "";
  return range.minX10 === range.maxX10 ? formatDecimalX10(range.minX10) : `${formatDecimalX10(range.minX10)}-${formatDecimalX10(range.maxX10)}`;
}
