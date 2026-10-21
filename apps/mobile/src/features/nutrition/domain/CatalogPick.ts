import type { DiaryEntry, MealSlot } from "./DiaryModel.ts";
import { rankUsage } from "./DiaryRules.ts";
import type { FoodProduct } from "./FoodModel.ts";
import type { Recipe } from "./RecipeModel.ts";
import { gramsFromPieces, parseDecimalX10 } from "./FoodRules.ts";
import { snapshotOfFood, snapshotOfRecipe, type FoodSnapshot } from "./FoodSnapshot.ts";

export type CatalogItem = (Readonly<{ kind: "FOOD"; food: FoodProduct }> | Readonly<{ kind: "RECIPE"; recipe: Recipe }>)
  & Readonly<{ suggested?: FoodSnapshot; usageSlot?: MealSlot }>;
export interface PortionDraft { readonly mode: "BASIS" | "PIECES"; readonly recipeUnit: "PORTION" | "G"; readonly text: string }
export const catalogKey = (item: CatalogItem): string => item.kind === "FOOD" ? `f:${item.food.id}` : `r:${item.recipe.id}`;
export function usageSuggestions(entries: readonly DiaryEntry[], slot: MealSlot, order: "recent" | "frequent", limit: number) {
  const ranked = rankUsage(entries, order, limit);
  const latest = (rows: readonly DiaryEntry[]) => rows.reduce<DiaryEntry | null>((best, entry) => best === null || entry.localDate >= best.localDate ? entry : best, null);
  return ranked.map((used) => {
    const matches = entries.filter((entry) => entry.snapshot.source.kind === used.kind && entry.snapshot.source.id === used.id);
    const sameSlot = order === "recent" ? latest(matches.filter((entry) => entry.slot === slot)) : null;
    const entry = sameSlot ?? latest(matches)!;
    return { ...used, snapshot: entry.snapshot, slot: entry.slot, sameSlot: sameSlot !== null };
  }).sort((a, b) => order === "recent" ? Number(b.sameSlot) - Number(a.sameSlot) : 0);
}
/** Validate before state mutation. A malformed draft must never silently become the default portion. */
export function pickSnapshot(item: CatalogItem, draft?: PortionDraft): FoodSnapshot {
  if (draft === undefined) {
    if (item.suggested !== undefined) {
      const source = item.suggested;
      return item.kind === "FOOD" ? snapshotOfFood(item.food, source.quantityX10)
        : snapshotOfRecipe(item.recipe, source.basis.unit === "G" && item.recipe.cookedMassX10 !== null ? "G" : "PORTION",
          source.basis.unit === "G" && item.recipe.cookedMassX10 === null ? 10 : source.quantityX10);
    }
    return item.kind === "FOOD" ? snapshotOfFood(item.food, item.food.amountX10) : snapshotOfRecipe(item.recipe, "PORTION", 10);
  }
  const typed = parseDecimalX10(draft.text);
  if (typed === null || typed <= 0) throw new Error("INVALID_PORTION");
  const quantity = draft.mode === "PIECES" && item.kind === "FOOD" ? gramsFromPieces(typed, item.food.gramsPerPieceX10 ?? null) : typed;
  return item.kind === "FOOD" ? snapshotOfFood(item.food, quantity) : snapshotOfRecipe(item.recipe, draft.recipeUnit, quantity);
}
