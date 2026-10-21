import type { Recipe } from "./RecipeModel.ts";
import { recipeBases } from "./RecipeRules.ts";

export type RecipeSort = "DEFAULT" | "NEWEST" | "OLDEST" | "KCAL_ASC" | "KCAL_DESC";
export type CalorieBand = "ANY" | "UNDER_100" | "100_250" | "250_500" | "OVER_500";
export type TimeBand = "ANY" | "UNDER_15" | "15_30" | "30_60" | "OVER_60";
export type MacroName = "protein" | "fat" | "carbs";
export interface RecipeFilters {
  readonly calories: CalorieBand;
  readonly time: TimeBand;
  readonly macros: Readonly<Record<MacroName, Readonly<{ min: number; max: number }>>>;
}
export const EMPTY_RECIPE_FILTERS: RecipeFilters = { calories: "ANY", time: "ANY", macros: { protein: { min: 0, max: 100 }, fat: { min: 0, max: 100 }, carbs: { min: 0, max: 100 } } };
/** Percentages use macro energy (4/9/4), independent of manually entered calories. Unknowns fail only an active filter. */
export function browseRecipes(recipes: readonly Recipe[], filters: RecipeFilters, sort: RecipeSort): readonly Recipe[] {
  const rows = recipes.map((recipe) => ({ recipe, nutrients: recipeBases(recipe)[0]!.nutrients })).filter(({ recipe, nutrients: n }) => {
    if (filters.time !== "ANY") {
      if (recipe.details?.prepMinutes == null || recipe.details.cookMinutes === null) return false;
      const time = recipe.details.prepMinutes + recipe.details.cookMinutes;
      if (filters.time === "UNDER_15" && time >= 15) return false;
      if (filters.time === "15_30" && (time < 15 || time >= 30)) return false;
      if (filters.time === "30_60" && (time < 30 || time > 60)) return false;
      if (filters.time === "OVER_60" && time <= 60) return false;
    }
    const kcal = n.kcalX10 === null ? null : n.kcalX10 / 10;
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
      const total = values.protein! * 4 + values.fat! * 9 + values.carbs! * 4;
      if (total === 0) return false;
      const percent = values[key]! * (key === "fat" ? 9 : 4) * 100 / total;
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
