import type { TargetRange } from "./TargetModel.ts";

/** Энергетическая ценность макронутриентов, ккал на грамм (владелец, UX 2.0): белки 4, жиры 9, углеводы 4. */
const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 } as const;

/** Калории из Б/Ж/У; значения и результат — десятые доли (г×10 → ккал×10). Неизвестен любой из трёх — `null`: неполная сумма не выдаётся за итог. */
export function kcalFromMacrosX10(macros: Readonly<{ proteinX10: number | null; fatX10: number | null; carbsX10: number | null }>): number | null {
  if (macros.proteinX10 === null || macros.fatX10 === null || macros.carbsX10 === null) return null;
  return KCAL_PER_G.protein * macros.proteinX10 + KCAL_PER_G.fat * macros.fatX10 + KCAL_PER_G.carbs * macros.carbsX10;
}

/** Диапазон калорий из диапазонов Б/Ж/У (нижняя из нижних, верхняя из верхних), округлён до целых ккал. Нет цели хотя бы по одному макро — `null`. */
export function kcalRangeFromMacros(ranges: Readonly<{ protein: TargetRange | null; fat: TargetRange | null; carbs: TargetRange | null }>): TargetRange | null {
  if (ranges.protein === null || ranges.fat === null || ranges.carbs === null) return null;
  const whole = (valueX10: number) => Math.round(valueX10 / 10) * 10;
  const min = kcalFromMacrosX10({ proteinX10: ranges.protein.minX10, fatX10: ranges.fat.minX10, carbsX10: ranges.carbs.minX10 }) as number;
  const max = kcalFromMacrosX10({ proteinX10: ranges.protein.maxX10, fatX10: ranges.fat.maxX10, carbsX10: ranges.carbs.maxX10 }) as number;
  return { minX10: whole(min), maxX10: whole(max) };
}

/**
 * Калории по введённым макронутриентам (4/9/4): считаются сразу, даже если введён один показатель (UX 2.0, решение владельца); неведённые не учитываются. Ничего не введено — `null`.
 * Округление до целых ккал. Для полного набора совпадает с `kcalRangeFromMacros`.
 */
export function kcalRangeFromEntered(ranges: Readonly<{ protein: TargetRange | null; fat: TargetRange | null; carbs: TargetRange | null }>): TargetRange | null {
  const parts = [[ranges.protein, KCAL_PER_G.protein], [ranges.fat, KCAL_PER_G.fat], [ranges.carbs, KCAL_PER_G.carbs]] as const;
  if (parts.every(([range]) => range === null)) return null;
  const sum = (pick: (range: TargetRange) => number) => parts.reduce((total, [range, k]) => total + (range === null ? 0 : k * pick(range)), 0);
  const whole = (valueX10: number) => Math.round(valueX10 / 10) * 10;
  return { minX10: whole(sum((range) => range.minX10)), maxX10: whole(sum((range) => range.maxX10)) };
}
