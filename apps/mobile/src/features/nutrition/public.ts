export { NutritionWorkspacePreview } from "./presentation/NutritionWorkspacePreview.tsx";
export type { FoodBasis, FoodBasisUnit, FoodInput, FoodProduct, Nutrients } from "./domain/FoodModel.ts";
export type { FoodCatalogCommittedChange, FoodCatalogPort } from "./domain/FoodCatalogPort.ts";
export { formatDecimalX10, parseDecimalX10, scaleNutrients, validateFood } from "./domain/FoodRules.ts";
export type { Recipe, RecipeIngredient, RecipeInput } from "./domain/RecipeModel.ts";
export type { RecipeCatalogCommittedChange, RecipeCatalogPort } from "./domain/RecipeCatalogPort.ts";
export type { FoodSnapshot } from "./domain/FoodSnapshot.ts";
export { recipeBases, recipeTotals, validateRecipe, type RecipeBasis } from "./domain/RecipeRules.ts";
export { snapshotOfFood, snapshotOfRecipe } from "./domain/FoodSnapshot.ts";
