import { automaticMacroRanges, pointMacroRanges, rebalanceMacroRanges, type MacroGrams, type MacroRanges } from "./CalcRules.ts";
import { kcalRangeFromMacros } from "./EnergyRules.ts";
import type { Corridors, HomeMacroAdjustment, TargetRange, TargetVersion } from "./TargetModel.ts";
import { versionFor } from "./TargetRules.ts";

export const EMPTY_MANUAL_MACROS: HomeMacroAdjustment["manual"] = { protein: null, fat: null, carbs: null };

/** Старые числовые цели не являются ручным вводом главной и не заменяют автоматический расчёт. */
export function homeAdjustmentFor(versions: readonly TargetVersion[], localDate: string): HomeMacroAdjustment | null {
  return versionFor(versions, localDate)?.homeAdjustment ?? null;
}

export interface HomeMacroResult {
  readonly corridors: Corridors;
  readonly problem: string | null;
}

/** Единый результат для верхней сводки и сохранения. Неполная сумма не становится калоражем. */
export function deriveHomeMacroTarget(calories: number | null, defaults: MacroGrams, leanMassKg: number | null,
  manual: HomeMacroAdjustment["manual"], mode: HomeMacroAdjustment["mode"] = "EXACT"): HomeMacroResult {
  const grams = (range: TargetRange | null) => range === null ? null : { min: range.minX10 / 10, max: range.maxX10 / 10 };
  const toTarget = (range: MacroRanges["protein"]): TargetRange | null => range === null ? null : { minX10: Math.round(range.min * 10), maxX10: Math.round(range.max * 10) };
  const count = Object.values(manual).filter((value) => value !== null).length;
  const kcal = calories === null ? null : { minX10: Math.round(calories * 10), maxX10: Math.round(calories * 10) };
  try {
    const automatic = mode === "RANGE" ? automaticMacroRanges(calories, defaults, leanMassKg) : pointMacroRanges(defaults);
    const result = rebalanceMacroRanges(calories, automatic, { protein: grams(manual.protein), fat: grams(manual.fat), carbs: grams(manual.carbs) }, leanMassKg);
    const macros = { protein: toTarget(result.protein), fat: toTarget(result.fat), carbs: toTarget(result.carbs) };
    const complete = Object.values(macros).every((range) => range !== null);
    return { corridors: { ...macros, kcal: count === 3 ? kcalRangeFromMacros(macros) : kcal },
      problem: count === 0 && macros.protein !== null && macros.fat !== null && macros.carbs === null
        ? "Расчётные БЖУ превышают суточный ориентир. Проверьте параметры расчёта или задайте все три нутриента вручную."
        : count > 0 && (!complete || (count < 3 && kcal === null)) ? "Недостаточно данных для пересчёта. Заполните исходные данные в разделе «Питание» или задайте все три нутриента вручную." : null };
  } catch (failure) {
    const code = failure instanceof Error ? failure.message : "";
    const problem = code === "MACRO_FAT_RANGE" ? "Расчётный жир выходит за пределы 0,8–1 г/кг сухой массы. Измените белки или углеводы либо задайте все три значения вручную."
      : code === "MACRO_MASS_REQUIRED" ? "Для автоматического расчёта жира нужны вес и процент жира. Заполните их в разделе «Питание»."
      : "Введённые значения превышают суточный ориентир по калориям. Уменьшите их либо задайте все три нутриента вручную.";
    return { corridors: { kcal, ...manual }, problem };
  }
}
