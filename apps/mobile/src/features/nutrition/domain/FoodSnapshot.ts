import type { FoodBasis, FoodBasisUnit, FoodProduct, Nutrients } from "./FoodModel.ts";
import { scaleNutrients } from "./FoodRules.ts";
import type { Recipe } from "./RecipeModel.ts";
import { recipeBases } from "./RecipeRules.ts";

/**
 * Исторический снимок использованного продукта или рецепта (§49.5.1): название, основа, значения на основу, фактическое
 * количество и итоговые значения. Дневная запись хранит его целиком; правка каталога прошлые дни не меняет (§49.5.2).
 */
export interface FoodSnapshot {
  /** Устойчивая ссылка на источник; продукт или рецепт могут быть позже скрыты. */
  readonly source: Readonly<{ kind: "FOOD" | "RECIPE"; id: string }>;
  readonly name: string;
  readonly brand: string | null;
  readonly basis: FoodBasis;
  readonly perBasis: Nutrients;
  readonly quantityX10: number;
  /** Значения на фактическое количество; неизвестное остаётся `null`. */
  readonly eaten: Nutrients;
  /** Состав рецепта на момент записи — справка, в сумму дня повторно не входит (§49.5.3). */
  readonly ingredients: readonly Readonly<{ foodId: string; name: string; unit: FoodBasisUnit; quantityX10: number }>[];
}

export function snapshotOfFood(food: FoodProduct, quantityX10: number): FoodSnapshot {
  const perBasis: Nutrients = { kcalX10: food.kcalX10, proteinX10: food.proteinX10, fatX10: food.fatX10, carbsX10: food.carbsX10 };
  return { source: { kind: "FOOD", id: food.id }, name: food.name, brand: food.brand, basis: { unit: food.unit, amountX10: food.amountX10 },
    perBasis, quantityX10, eaten: scaleNutrients(food, quantityX10), ingredients: [] };
}

/** `unit` — «PORTION» (порции) или «G» (граммы, если у рецепта указана масса готового блюда); иначе `INVALID_PORTION`. */
export function snapshotOfRecipe(recipe: Recipe, unit: "PORTION" | "G", quantityX10: number): FoodSnapshot {
  const chosen = recipeBases(recipe).find((item) => item.basis.unit === unit);
  if (chosen === undefined) throw new Error("INVALID_PORTION");
  return { source: { kind: "RECIPE", id: recipe.id }, name: recipe.name, brand: null, basis: chosen.basis, perBasis: chosen.nutrients, quantityX10,
    eaten: scaleNutrients({ ...chosen.basis, ...chosen.nutrients }, quantityX10),
    ingredients: recipe.ingredients.map((item) => ({ foodId: item.food.id, name: item.food.name, unit: item.food.unit, quantityX10: item.quantityX10 })) };
}
