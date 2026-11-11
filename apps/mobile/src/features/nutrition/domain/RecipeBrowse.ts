import type { Recipe } from "./RecipeModel.ts";
import { KCAL_PER_G, kcalFromMacrosX10 } from "./EnergyRules.ts";
import { recipeBases } from "./RecipeRules.ts";

export type RecipeSort = "DEFAULT" | "NEWEST" | "OLDEST" | "KCAL_ASC" | "KCAL_DESC";
export type CalorieBand = "ANY" | "UNDER_100" | "100_250" | "250_500" | "OVER_500";
export type TimeBand = "ANY" | "UNDER_15" | "15_30" | "30_60" | "OVER_60";
export type MacroName = "protein" | "fat" | "carbs";
/** Свой диапазон: границы включительно, `null` — граница не задана. */
export interface NumberRange { readonly min: number | null; readonly max: number | null }
export const NO_RANGE: NumberRange = { min: null, max: null };
export interface RecipeFilters {
  readonly calories: CalorieBand;
  readonly time: TimeBand;
  readonly macros: Readonly<Record<MacroName, Readonly<{ min: number; max: number }>>>;
  /** Свой диапазон калорий за порцию, ккал (вместо готовой полосы). */
  readonly caloriesRange: NumberRange;
  /** Свой диапазон общего времени (подготовка + готовка), мин. */
  readonly timeRange: NumberRange;
  /** Подготовка не дольше N минут (в рецепте подготовка и готовка хранятся отдельно); `null` — без ограничения. */
  readonly prepMax: number | null;
}
export const EMPTY_RECIPE_FILTERS: RecipeFilters = { calories: "ANY", time: "ANY", macros: { protein: { min: 0, max: 100 }, fat: { min: 0, max: 100 }, carbs: { min: 0, max: 100 } },
  caloriesRange: NO_RANGE, timeRange: NO_RANGE, prepMax: null };

const rangeActive = (range: NumberRange) => range.min !== null || range.max !== null;
const inRange = (value: number, range: NumberRange) => (range.min === null || value >= range.min) && (range.max === null || value <= range.max);
/** Задан ли хоть один фильтр (для подсказки «Нет рецептов по этим условиям» и кнопки «Сбросить фильтры»). */
export function hasRecipeFilters(filters: RecipeFilters): boolean {
  return filters.calories !== "ANY" || filters.time !== "ANY" || rangeActive(filters.caloriesRange) || rangeActive(filters.timeRange) || filters.prepMax !== null
    || Object.values(filters.macros).some((range) => range.min !== 0 || range.max !== 100);
}

/**
 * Разбор двух полей «от» и «до» целых чисел (ккал, минуты). Пустое поле — граница не задана; не целое, отрицательное, больше `limit`
 * или «от» больше «до» — `"INVALID"`.
 */
export function parseNumberRange(minText: string, maxText: string, limit: number): NumberRange | "INVALID" {
  const one = (text: string): number | null | "INVALID" => {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    if (!/^\d{1,6}$/u.test(trimmed)) return "INVALID";
    const value = Number(trimmed);
    return value > limit ? "INVALID" : value;
  };
  const min = one(minText); const max = one(maxText);
  if (min === "INVALID" || max === "INVALID" || (min !== null && max !== null && min > max)) return "INVALID";
  return { min, max };
}
/** Percentages use macro energy (4/9/4), independent of manually entered calories. Unknowns fail only an active filter. */
export function browseRecipes(recipes: readonly Recipe[], filters: RecipeFilters, sort: RecipeSort): readonly Recipe[] {
  const rows = recipes.map((recipe) => ({ recipe, nutrients: recipeBases(recipe)[0]!.nutrients })).filter(({ recipe, nutrients: n }) => {
    if (rangeActive(filters.timeRange) || filters.prepMax !== null) {
      if (recipe.details?.prepMinutes == null || recipe.details.cookMinutes === null) return false;
      if (filters.prepMax !== null && recipe.details.prepMinutes > filters.prepMax) return false;
      if (!inRange(recipe.details.prepMinutes + recipe.details.cookMinutes, filters.timeRange)) return false;
    }
    if (filters.time !== "ANY") {
      if (recipe.details?.prepMinutes == null || recipe.details.cookMinutes === null) return false;
      const time = recipe.details.prepMinutes + recipe.details.cookMinutes;
      if (filters.time === "UNDER_15" && time >= 15) return false;
      if (filters.time === "15_30" && (time < 15 || time >= 30)) return false;
      if (filters.time === "30_60" && (time < 30 || time > 60)) return false;
      if (filters.time === "OVER_60" && time <= 60) return false;
    }
    const kcal = n.kcalX10 === null ? null : n.kcalX10 / 10;
    if (rangeActive(filters.caloriesRange) && (kcal === null || !inRange(kcal, filters.caloriesRange))) return false;
    if (filters.calories !== "ANY") {
      if (kcal === null) return false;
      if (filters.calories === "UNDER_100" && kcal >= 100) return false;
      if (filters.calories === "100_250" && (kcal < 100 || kcal >= 250)) return false;
      if (filters.calories === "250_500" && (kcal < 250 || kcal > 500)) return false;
      if (filters.calories === "OVER_500" && kcal <= 500) return false;
    }
    const values = { protein: n.proteinX10, fat: n.fatX10, carbs: n.carbsX10 };
    for (const key of ["protein", "fat", "carbs"] as const) {
      const range = filters.macros[key];
      if (range.min === 0 && range.max === 100) continue;
      if (Object.values(values).some((value) => value === null)) return false;
      const total = kcalFromMacrosX10({ proteinX10: values.protein, fatX10: values.fat, carbsX10: values.carbs })!;
      if (total === 0) return false;
      const percent = values[key]! * KCAL_PER_G[key] * 100 / total;
      if (percent < range.min || percent > range.max) return false;
    }
    return true;
  });
  const byName = (a: Recipe, b: Recipe) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id);
  return rows.sort((a, b) => {
    if (sort === "NEWEST" || sort === "OLDEST") return (sort === "NEWEST" ? -1 : 1) * (a.recipe.createdAt ?? "").localeCompare(b.recipe.createdAt ?? "") || byName(a.recipe, b.recipe);
    if (sort === "KCAL_ASC" || sort === "KCAL_DESC") {
      if (a.nutrients.kcalX10 === null) return b.nutrients.kcalX10 === null ? byName(a.recipe, b.recipe) : 1;
      if (b.nutrients.kcalX10 === null) return -1;
      return (sort === "KCAL_ASC" ? 1 : -1) * (a.nutrients.kcalX10 - b.nutrients.kcalX10) || byName(a.recipe, b.recipe);
    }
    return byName(a.recipe, b.recipe);
  }).map((row) => row.recipe);
}

/**
 * Ряды кнопок выбора (UIX-FIT-12, макет владельца): первый вариант («По умолчанию», «Любые», «Любое время») — отдельным рядом на всю ширину,
 * остальные — по два в ряд. Последний неполный ряд остаётся из одного варианта (его ширина — одна колонка).
 */
export function choiceRows<T>(options: readonly T[]): readonly (readonly T[])[] {
  if (options.length === 0) return [];
  const rows: T[][] = [[options[0] as T]];
  for (let index = 1; index < options.length; index += 2) rows.push(options.slice(index, index + 2));
  return rows;
}
