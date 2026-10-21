import type { DiaryEntry } from "./DiaryModel.ts";
import { normalizeSnapshot } from "./DiaryRules.ts";
import type { FoodSnapshot } from "./FoodSnapshot.ts";

/** Клиентский набор снимков, отдельно от рецепта и общего каталога тренера. */
export interface SavedMeal {
  readonly id: string;
  readonly name: string;
  readonly snapshots: readonly FoodSnapshot[];
  readonly revision: number;
}
export interface SavedMealInput {
  readonly name: string;
  readonly snapshots: readonly FoodSnapshot[];
}
export function validateSavedMeal(input: SavedMealInput): SavedMealInput {
  const name = input.name.trim().replace(/\s+/gu, " ");
  if (name.length === 0 || name.length > 80) throw new Error("SAVED_MEAL_NAME_INVALID");
  if (input.snapshots.length === 0 || input.snapshots.length > 50) throw new Error("SAVED_MEAL_ITEMS_INVALID");
  return { name, snapshots: input.snapshots.map(normalizeSnapshot) };
}
/** Фиксируем действующую питательность, включая локальную правку; оригинал не мутируется. */
export function savedSnapshot(entry: DiaryEntry): FoodSnapshot {
  if (entry.override == null) return entry.snapshot;
  return { ...entry.snapshot, basis: { ...entry.snapshot.basis, amountX10: entry.snapshot.quantityX10 }, perBasis: entry.snapshot.eaten };
}
