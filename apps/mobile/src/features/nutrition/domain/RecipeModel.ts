import type { FoodProduct } from "./FoodModel.ts";

/** Ингредиент рецепта: продукт каталога (в том числе скрытый) и количество в его эталонных единицах, десятые доли. */
export interface RecipeIngredient {
  readonly food: FoodProduct;
  readonly quantityX10: number;
}

/** Рецепт из собственных продуктов (§49.4); пищевая ценность — только сумма ингредиентов, отдельного ввода БЖУ нет. */
export interface Recipe {
  readonly id: string;
  readonly name: string;
  /** Число порций блюда, десятые доли: `4 порции` → 40. */
  readonly servingsX10: number;
  /** Масса готового блюда, г×10; `null` — не указана и не выдумывается по сырому весу (§49.4.3). */
  readonly cookedMassX10: number | null;
  readonly ingredients: readonly RecipeIngredient[];
  readonly revision: number;
  readonly archivedAt: string | null;
}

export interface RecipeInput {
  readonly name: string;
  readonly servingsX10: number;
  readonly cookedMassX10: number | null;
  readonly ingredients: readonly Readonly<{ foodId: string; quantityX10: number }>[];
}
