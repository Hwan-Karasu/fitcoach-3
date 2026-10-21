import { MEAL_SLOTS, type DiaryEntry, type MealSlot, type UsageSummary } from "./DiaryModel.ts";
import type { FoodProduct } from "./FoodModel.ts";
import type { Recipe } from "./RecipeModel.ts";
import { gramsFromPieces, parseDecimalX10 } from "./FoodRules.ts";
import { snapshotOfFood, snapshotOfRecipe, type FoodSnapshot } from "./FoodSnapshot.ts";

export type CatalogItem = (Readonly<{ kind: "FOOD"; food: FoodProduct }> | Readonly<{ kind: "RECIPE"; recipe: Recipe }>)
  & Readonly<{ suggested?: FoodSnapshot; usageSlot?: MealSlot }>;
export interface PortionDraft { readonly mode: "BASIS" | "PIECES"; readonly recipeUnit: "PORTION" | "G"; readonly text: string }
export const catalogKey = (item: CatalogItem): string => item.kind === "FOOD" ? `f:${item.food.id}` : `r:${item.recipe.id}`;
export interface UsageSuggestion {
  readonly kind: "FOOD" | "RECIPE";
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** Последняя дата использования. */
  readonly lastDate: string;
  /** Снимок для предложения: последняя запись в этом приёме (для «Недавних»), иначе последняя вообще. */
  readonly snapshot: FoodSnapshot;
  readonly slot: MealSlot;
  readonly sameSlot: boolean;
}

/** Порядок записей дневника: дата, приём пищи, позиция в приёме; положительное — `a` позже `b`. */
const laterThan = (a: DiaryEntry, b: DiaryEntry) => a.localDate.localeCompare(b.localDate) || MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot) || a.position - b.position;

/** Сводки позиций из записей дневника (одна запись на позицию «последняя» и «последняя в приёме»); в SQL то же строит `listUsageSummaries`. */
export function summarizeUsage(entries: readonly DiaryEntry[], slot: MealSlot): readonly UsageSummary[] {
  const items = new Map<string, { kind: "FOOD" | "RECIPE"; id: string; count: number; latest: DiaryEntry; latestSeq: number; latestInSlot: DiaryEntry | null }>();
  entries.forEach((entry, seq) => {
    const { kind, id } = entry.snapshot.source;
    const key = `${kind}:${id}`;
    const item = items.get(key) ?? { kind, id, count: 0, latest: entry, latestSeq: seq, latestInSlot: null };
    item.count += 1;
    if (laterThan(entry, item.latest) >= 0) { item.latest = entry; item.latestSeq = seq; }
    if (entry.slot === slot && (item.latestInSlot === null || laterThan(entry, item.latestInSlot) >= 0)) item.latestInSlot = entry;
    items.set(key, item);
  });
  // При полном совпадении даты, приёма и позиции (в дневнике так не бывает) позже считается запись, стоящая в списке позже: такие позиции идут первыми, сортировка устойчива.
  return [...items.values()].sort((a, b) => b.latestSeq - a.latestSeq).map((item) => ({ kind: item.kind, id: item.id, count: item.count, latest: item.latest, latestInSlot: item.latestInSlot }));
}

/**
 * «Недавние» и «Частые» (§49.2) — производное чтение по дневнику, отдельного хранилища нет. Недавние: по последней записи позиции (дата, приём, позиция); частые: по числу
 * использований, затем по свежести. «Недавние» сначала показывают позиции, последний раз внесённые в тот же приём.
 */
export function usageFromSummaries(summaries: readonly UsageSummary[], order: "recent" | "frequent", limit: number): readonly UsageSuggestion[] {
  const recency = (a: UsageSummary, b: UsageSummary) => laterThan(b.latest, a.latest);
  return [...summaries].sort((a, b) => order === "frequent" ? b.count - a.count || recency(a, b) : recency(a, b)).slice(0, limit).map((item) => {
    const sameSlot = order === "recent" ? item.latestInSlot : null;
    const entry = sameSlot ?? item.latest;
    return { kind: item.kind, id: item.id, name: item.latest.snapshot.name, count: item.count, lastDate: item.latest.localDate, snapshot: entry.snapshot, slot: entry.slot, sameSlot: sameSlot !== null };
  }).sort((a, b) => order === "recent" ? Number(b.sameSlot) - Number(a.sameSlot) : 0);
}

export const usageSuggestions = (entries: readonly DiaryEntry[], slot: MealSlot, order: "recent" | "frequent", limit: number): readonly UsageSuggestion[] =>
  usageFromSummaries(summarizeUsage(entries, slot), order, limit);

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
