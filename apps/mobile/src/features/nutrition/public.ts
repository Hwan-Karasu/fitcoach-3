export { NutritionWorkspacePreview } from "./presentation/NutritionWorkspacePreview.tsx";
export type { FoodBasis, FoodBasisUnit, FoodInput, FoodProduct, Nutrients } from "./domain/FoodModel.ts";
export type { FoodCatalogCommittedChange, FoodCatalogPort } from "./domain/FoodCatalogPort.ts";
export { formatDecimalX10, parseDecimalX10, scaleNutrients, validateFood } from "./domain/FoodRules.ts";
