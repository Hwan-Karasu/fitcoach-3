import type { FoodBasis, Nutrients } from "./FoodModel.ts";
import { scaleNutrients } from "./FoodRules.ts";
import type { Recipe, RecipeInput } from "./RecipeModel.ts";

export type RecipeRuleError =
  | "RECIPE_NAME_INVALID"
  | "RECIPE_SERVINGS_INVALID"
  | "RECIPE_MASS_INVALID"
  | "RECIPE_INGREDIENT_INVALID"
  | "INVALID_PORTION";

function fail(code: RecipeRuleError): never { throw new Error(code); }

const NAME_MAX = 80;
const INGREDIENTS_MAX = 50;
const QUANTITY_MAX_X10 = 10_000_000;

/** Проверяет ввод рецепта: название, порции, масса готового блюда, непустой состав без повторов продукта. */
export function validateRecipe(input: RecipeInput): RecipeInput {
  const name = input.name.trim().replace(/\s+/gu, " ");
  if (name === "" || name.length > NAME_MAX) fail("RECIPE_NAME_INVALID");
  if (!Number.isInteger(input.servingsX10) || input.servingsX10 <= 0 || input.servingsX10 > 100_000) fail("RECIPE_SERVINGS_INVALID");
  if (input.cookedMassX10 !== null && (!Number.isInteger(input.cookedMassX10) || input.cookedMassX10 <= 0
    || input.cookedMassX10 > QUANTITY_MAX_X10)) fail("RECIPE_MASS_INVALID");
  if (input.ingredients.length === 0 || input.ingredients.length > INGREDIENTS_MAX) fail("RECIPE_INGREDIENT_INVALID");
  const seen = new Set<string>();
  for (const item of input.ingredients) {
    if (item.foodId === "" || seen.has(item.foodId) || !Number.isInteger(item.quantityX10)
      || item.quantityX10 <= 0 || item.quantityX10 > QUANTITY_MAX_X10) fail("RECIPE_INGREDIENT_INVALID");
    seen.add(item.foodId);
  }
  return { name, servingsX10: input.servingsX10, cookedMassX10: input.cookedMassX10, ingredients: input.ingredients.map((item) => ({ ...item })) };
}

/**
 * Сумма по ингредиентам (§49.4.2). Если у какого-то ингредиента нутриент не введён, итог по нему неизвестен (`null`):
 * неполная сумма не выдаётся за полную.
 */
export function recipeTotals(recipe: Pick<Recipe, "ingredients">): Nutrients {
  const parts = recipe.ingredients.map((item) => scaleNutrients(item.food, item.quantityX10));
  const total = (key: keyof Nutrients) => parts.some((part) => part[key] === null) ? null : parts.reduce((sum, part) => sum + (part[key] as number), 0);
  return { kcalX10: total("kcalX10"), proteinX10: total("proteinX10"), fatX10: total("fatX10"), carbsX10: total("carbsX10") };
}

export interface RecipeBasis {
  readonly basis: FoodBasis;
  readonly nutrients: Nutrients;
}

/**
 * Основы, в которых рецепт можно внести в дневник: всегда «1 порция»; «100 г» — только при указанной массе готового блюда (§49.4.3).
 */
export function recipeBases(recipe: Pick<Recipe, "ingredients" | "servingsX10" | "cookedMassX10">): readonly RecipeBasis[] {
  const totals = recipeTotals(recipe);
  const per = (divisorX10: number, factor: number): Nutrients => {
    const value = (key: keyof Nutrients) => totals[key] === null ? null : Math.round((totals[key] as number) * factor / divisorX10);
    return { kcalX10: value("kcalX10"), proteinX10: value("proteinX10"), fatX10: value("fatX10"), carbsX10: value("carbsX10") };
  };
  const bases: RecipeBasis[] = [{ basis: { unit: "PORTION", amountX10: 10 }, nutrients: per(recipe.servingsX10, 10) }];
  if (recipe.cookedMassX10 !== null) bases.push({ basis: { unit: "G", amountX10: 1000 }, nutrients: per(recipe.cookedMassX10, 1000) });
  return bases;
}
