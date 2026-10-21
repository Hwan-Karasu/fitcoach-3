import { FOOD_BASIS_UNITS, type Nutrients } from "./FoodModel.ts";
import { entryNutrients, sumNutrients } from "./EnergyRules.ts";
import { scaleNutrients } from "./FoodRules.ts";
import type { FoodSnapshot } from "./FoodSnapshot.ts";
import { MEAL_SLOTS, type DaySummary, type DiaryEntry, type MealSlot } from "./DiaryModel.ts";

export type DiaryRuleError =
  | "DIARY_DATE_INVALID"
  | "DIARY_SLOT_INVALID"
  | "DIARY_SNAPSHOT_INVALID"
  | "DIARY_COPY_SAME_TARGET"
  | "DIARY_OVERRIDE_INVALID"
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
    || !FOOD_BASIS_UNITS.includes(snapshot.basis.unit)) fail("DIARY_SNAPSHOT_INVALID");
  assertQuantity(snapshot.quantityX10);
  const eaten = scaleNutrients({ ...snapshot.basis, ...snapshot.perBasis }, snapshot.quantityX10);
  return { ...snapshot, name, eaten };
}

// Суммирование живёт в EnergyRules (общее с рецептами, без цикла импортов); здесь — прежнее место импорта.
export { entryNutrients, sumNutrients };

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

export interface UsageItem {
  readonly kind: "FOOD" | "RECIPE";
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** Последняя дата использования. */
  readonly lastDate: string;
}

/**
 * «Недавние» и «Частые» (§49.2) — производное чтение по записям дневника, отдельного хранилища нет. Недавние: по последней дате, при равенстве позже внесённая
 * запись выше; частые: по числу использований, затем по свежести.
 */
export function rankUsage(entries: readonly DiaryEntry[], order: "recent" | "frequent", limit: number): readonly UsageItem[] {
  const items = new Map<string, UsageItem & { seq: number }>();
  entries.forEach((entry, seq) => {
    const { source, name } = entry.snapshot;
    const key = `${source.kind}:${source.id}`;
    const before = items.get(key);
    const newer = before === undefined || entry.localDate > before.lastDate || (entry.localDate === before.lastDate && seq > before.seq);
    items.set(key, { kind: source.kind, id: source.id, name: newer ? name : before.name, count: (before?.count ?? 0) + 1,
      lastDate: newer ? entry.localDate : before.lastDate, seq: newer ? seq : before.seq });
  });
  const recency = (a: UsageItem & { seq: number }, b: UsageItem & { seq: number }) => b.lastDate.localeCompare(a.lastDate) || b.seq - a.seq;
  return [...items.values()].sort((a, b) => order === "frequent" ? b.count - a.count || recency(a, b) : recency(a, b)).slice(0, limit)
    .map((item) => ({ kind: item.kind, id: item.id, name: item.name, count: item.count, lastDate: item.lastDate }));
}

const OVERRIDE_MAX_X10 = 10_000_000;

/** Проверка правки: хотя бы один показатель задан, значения — целые десятые ≥ 0 (явный 0 допустим); `null` — не правится. */
export function assertOverride(values: Nutrients): void {
  const parts = [values.kcalX10, values.proteinX10, values.fatX10, values.carbsX10];
  if (parts.every((value) => value === null) || parts.some((value) => value !== null && (!Number.isInteger(value) || value < 0 || value > OVERRIDE_MAX_X10))) fail("DIARY_OVERRIDE_INVALID");
}

/**
 * Действующие значения записи: правленный показатель — значение правки, пропорционально масштабированное к текущему количеству (`правка × количество / база`),
 * остальные — по каталогу. Неизвестный и не правленный показатель остаётся неизвестным (`null`), а не нулём.
 */
export function effectiveNutrients(catalog: Nutrients, override: { readonly baseQuantityX10: number; readonly values: Nutrients } | null, quantityX10: number): Nutrients {
  if (override === null) return catalog;
  const scaled = (value: number | null, fallback: number | null) => value === null ? fallback : Math.round((value * quantityX10) / override.baseQuantityX10);
  return { kcalX10: scaled(override.values.kcalX10, catalog.kcalX10), proteinX10: scaled(override.values.proteinX10, catalog.proteinX10),
    fatX10: scaled(override.values.fatX10, catalog.fatX10), carbsX10: scaled(override.values.carbsX10, catalog.carbsX10) };
}
