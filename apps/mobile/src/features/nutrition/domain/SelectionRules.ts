import { MEAL_SLOTS, type DiaryEntryInput, type MealSlot } from "./DiaryModel.ts";
import type { FoodSnapshot } from "./FoodSnapshot.ts";

/** Выбранная в каталоге позиция с её персональной порцией (черновик до подтверждения, NUT-FS-23). */
export interface SelectedPick {
  readonly key: string;
  readonly snapshot: FoodSnapshot;
}

export interface BatchPlan {
  readonly items: number;
  readonly slots: number;
  readonly total: number;
  readonly entries: readonly DiaryEntryInput[];
  /** Несколько приёмов дублируют позиции — это нужно явно подтвердить (NUT-FS-24). */
  readonly needsConfirmation: boolean;
  readonly summary: string;
}

const plural = (count: number, one: string, few: string, many: string) => {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return many;
  return count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many;
};

/**
 * План одной атомарной записи: каждая выбранная позиция — в каждый выбранный приём (N × M). Повторы позиции и приёма схлопываются; порядок приёмов — как
 * в дневнике, позиций — как выбрано. Сама запись — `NutritionDiaryPort.addEntries` одной транзакцией.
 */
export function planBatch(localDate: string, picks: readonly SelectedPick[], slots: readonly MealSlot[]): BatchPlan {
  const uniquePicks = picks.filter((pick, index) => picks.findIndex((other) => other.key === pick.key) === index);
  const orderedSlots = MEAL_SLOTS.filter((slot) => slots.includes(slot));
  const entries = orderedSlots.flatMap((slot) => uniquePicks.map((pick): DiaryEntryInput => ({ localDate, slot, snapshot: pick.snapshot })));
  const n = uniquePicks.length;
  const m = orderedSlots.length;
  const summary = `${n} ${plural(n, "позиция", "позиции", "позиций")} × ${m} ${plural(m, "приём", "приёма", "приёмов")} = ${entries.length} ${plural(entries.length, "запись", "записи", "записей")}`;
  return { items: n, slots: m, total: entries.length, entries, needsConfirmation: m > 1, summary };
}
