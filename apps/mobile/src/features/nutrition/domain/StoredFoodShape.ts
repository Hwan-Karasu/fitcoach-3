import { arrayOf, id, integer, nullableInteger, nullableText, object, text } from "../../../shared/domain/JsonShape.ts";
import type { FoodSnapshot } from "./FoodSnapshot.ts";
import type { Nutrients } from "./FoodModel.ts";
const unit = (value: unknown): boolean => ["G", "ML", "PIECE", "PORTION"].includes(String(value));
const nutrients = (value: unknown): value is Nutrients => object(value)
  && [value.kcalX10, value.proteinX10, value.fatX10, value.carbsX10].every(nullableInteger);
const ingredient = (value: unknown): value is FoodSnapshot["ingredients"][number] => object(value)
  && id(value.foodId) && text(value.name) && unit(value.unit) && integer(value.quantityX10) && value.quantityX10 > 0;
export const storedIngredients = (value: unknown): value is FoodSnapshot["ingredients"] => arrayOf(value, ingredient);
export const storedFoodSnapshot = (value: unknown): value is FoodSnapshot => object(value) && object(value.source) && id(value.source.id)
  && ["FOOD", "RECIPE"].includes(String(value.source.kind)) && text(value.name) && nullableText(value.brand)
  && object(value.basis) && unit(value.basis.unit) && integer(value.basis.amountX10) && value.basis.amountX10 > 0
  && nutrients(value.perBasis) && nutrients(value.eaten) && integer(value.quantityX10) && value.quantityX10 > 0
  && storedIngredients(value.ingredients);
export const storedFoodSnapshots = (value: unknown): value is FoodSnapshot[] => arrayOf(value, storedFoodSnapshot);
