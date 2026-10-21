import type { Nutrients } from "./FoodModel.ts";
import type { TargetRange } from "./TargetModel.ts";

/** Энергетическая ценность макронутриентов, ккал на грамм (владелец, UX 2.0): белки 4, жиры 9, углеводы 4. */
export const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 } as const;

/** Калории из Б/Ж/У; значения и результат — десятые доли (г×10 → ккал×10). Неизвестен любой из трёх — `null`: неполная сумма не выдаётся за итог. */
export function kcalFromMacrosX10(macros: Readonly<{ proteinX10: number | null; fatX10: number | null; carbsX10: number | null }>): number | null {
  if (macros.proteinX10 === null || macros.fatX10 === null || macros.carbsX10 === null) return null;
  return KCAL_PER_G.protein * macros.proteinX10 + KCAL_PER_G.fat * macros.fatX10 + KCAL_PER_G.carbs * macros.carbsX10;
}

/** Калории продукта совпадают с 4/9/4 по его Б/Ж/У — значит, они были посчитаны автоматически (редактор продукта не хранит признак происхождения). */
export function kcalIsDerived(nutrients: Readonly<{ kcalX10: number | null; proteinX10: number | null; fatX10: number | null; carbsX10: number | null }>): boolean {
  return nutrients.kcalX10 !== null && nutrients.kcalX10 === kcalFromMacrosX10(nutrients);
}

/** Калории по известным Б/Ж/У (4/9/4): неизвестный нутриент не учитывается; не известен ни один — `null`. Десятые доли, как у `kcalFromMacrosX10`. */
export function kcalFromKnownMacrosX10(macros: Readonly<{ proteinX10: number | null; fatX10: number | null; carbsX10: number | null }>): number | null {
  if (macros.proteinX10 === null && macros.fatX10 === null && macros.carbsX10 === null) return null;
  return KCAL_PER_G.protein * (macros.proteinX10 ?? 0) + KCAL_PER_G.fat * (macros.fatX10 ?? 0) + KCAL_PER_G.carbs * (macros.carbsX10 ?? 0);
}

/** Диапазон калорий из диапазонов Б/Ж/У (нижняя из нижних, верхняя из верхних), округлён до целых ккал. Нет цели хотя бы по одному макро — `null`. */
export function kcalRangeFromMacros(ranges: Readonly<{ protein: TargetRange | null; fat: TargetRange | null; carbs: TargetRange | null }>): TargetRange | null {
  if (ranges.protein === null || ranges.fat === null || ranges.carbs === null) return null;
  const whole = (valueX10: number) => Math.round(valueX10 / 10) * 10;
  const min = kcalFromMacrosX10({ proteinX10: ranges.protein.minX10, fatX10: ranges.fat.minX10, carbsX10: ranges.carbs.minX10 }) as number;
  const max = kcalFromMacrosX10({ proteinX10: ranges.protein.maxX10, fatX10: ranges.fat.maxX10, carbsX10: ranges.carbs.maxX10 }) as number;
  return { minX10: whole(min), maxX10: whole(max) };
}

const NONE: Nutrients = { kcalX10: null, proteinX10: null, fatX10: null, carbsX10: null };

/** Значения записи для показа и сумм: калории без числа досчитываются из известных Б/Ж/У (4/9/4); сам снимок не меняется. */
export function entryNutrients(eaten: Nutrients): Nutrients {
  if (eaten.kcalX10 !== null) return eaten;
  return { ...eaten, kcalX10: kcalFromKnownMacrosX10(eaten) };
}

/** Сумма записей (как в 2.0, решение владельца 2026-10-21): неизвестный нутриент считается нулём; итог неизвестен, только если он неизвестен во всех записях. */
export function sumNutrients(parts: readonly Nutrients[]): Nutrients {
  if (parts.length === 0) return NONE;
  const full = parts.map(entryNutrients);
  const total = (key: keyof Nutrients) => full.every((part) => part[key] === null) ? null : full.reduce((sum, part) => sum + (part[key] ?? 0), 0);
  return { kcalX10: total("kcalX10"), proteinX10: total("proteinX10"), fatX10: total("fatX10"), carbsX10: total("carbsX10") };
}
