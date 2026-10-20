import type { Nutrients } from "./FoodModel.ts";
import { scaleNutrients } from "./FoodRules.ts";
import type { FoodSnapshot } from "./FoodSnapshot.ts";
import { MEAL_SLOTS, type DaySummary, type DiaryEntry, type MealSlot } from "./DiaryModel.ts";

export type DiaryRuleError =
  | "DIARY_DATE_INVALID"
  | "DIARY_SLOT_INVALID"
  | "DIARY_SNAPSHOT_INVALID"
  | "WATER_INVALID"
  | "INVALID_PORTION";

function fail(code: DiaryRuleError): never { throw new Error(code); }

const QUANTITY_MAX_X10 = 10_000_000;
/** Больше 20 л воды за день — опечатка. */
export const WATER_MAX_ML = 20_000;

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function assertDate(value: string): void {
  if (!isLocalDate(value)) fail("DIARY_DATE_INVALID");
}

export function assertSlot(slot: string): asserts slot is MealSlot {
  if (!(MEAL_SLOTS as readonly string[]).includes(slot)) fail("DIARY_SLOT_INVALID");
}

export function assertQuantity(quantityX10: number): void {
  if (!Number.isInteger(quantityX10) || quantityX10 <= 0 || quantityX10 > QUANTITY_MAX_X10) fail("INVALID_PORTION");
}

export function assertWater(ml: number): void {
  if (!Number.isInteger(ml) || ml <= 0 || ml > WATER_MAX_ML) fail("WATER_INVALID");
}

/**
 * Проверяет снимок перед записью и пересчитывает `eaten` из значений на основу и количества: вызывающему не доверяем итог,
 * так что запись и суммы дня всегда согласованы.
 */
export function normalizeSnapshot(snapshot: FoodSnapshot): FoodSnapshot {
  const name = snapshot.name.trim();
  if (name === "" || (snapshot.source.kind !== "FOOD" && snapshot.source.kind !== "RECIPE") || snapshot.source.id === ""
    || !["G", "ML", "PORTION"].includes(snapshot.basis.unit)) fail("DIARY_SNAPSHOT_INVALID");
  assertQuantity(snapshot.quantityX10);
  const eaten = scaleNutrients({ ...snapshot.basis, ...snapshot.perBasis }, snapshot.quantityX10);
  return { ...snapshot, name, eaten };
}

const NONE: Nutrients = { kcalX10: null, proteinX10: null, fatX10: null, carbsX10: null };

/** Сумма записей: неизвестный нутриент в любой записи делает итог по нему неизвестным (§49.22 п. 4, сценарий про белок). */
export function sumNutrients(parts: readonly Nutrients[]): Nutrients {
  if (parts.length === 0) return NONE;
  const total = (key: keyof Nutrients) => parts.some((part) => part[key] === null) ? null : parts.reduce((sum, part) => sum + (part[key] as number), 0);
  return { kcalX10: total("kcalX10"), proteinX10: total("proteinX10"), fatX10: total("fatX10"), carbsX10: total("carbsX10") };
}

/** Итоги одного дня по записям этой даты. Без пищевых записей день `NO_FOOD` и без чисел; вода сюда не входит. */
export function summarizeDay(localDate: string, entries: readonly DiaryEntry[]): DaySummary {
  const day = entries.filter((entry) => entry.localDate === localDate);
  const bySlot = Object.fromEntries(MEAL_SLOTS.map((slot) => {
    const slotEntries = day.filter((entry) => entry.slot === slot);
    return [slot, slotEntries.length === 0 ? null : sumNutrients(slotEntries.map((entry) => entry.snapshot.eaten))];
  })) as Record<MealSlot, Nutrients | null>;
  return { localDate, state: day.length === 0 ? "NO_FOOD" : "FOOD_RECORDED", foodEntries: day.length,
    totals: sumNutrients(day.map((entry) => entry.snapshot.eaten)), bySlot };
}

/** Даты «с учётом» (П15=B): есть хотя бы одна пищевая запись. По возрастанию. */
export function accountedDates(entries: readonly DiaryEntry[]): readonly string[] {
  return [...new Set(entries.map((entry) => entry.localDate))].sort();
}
