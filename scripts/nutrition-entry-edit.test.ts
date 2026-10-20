import assert from "node:assert/strict";
import test from "node:test";
import type { DiaryEntry } from "../apps/mobile/src/features/nutrition/domain/DiaryModel.ts";
import { planOverride, type FieldEdits } from "../apps/mobile/src/features/nutrition/domain/EntryEditRules.ts";
import type { FoodProduct } from "../apps/mobile/src/features/nutrition/domain/FoodModel.ts";
import { snapshotOfFood } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";

/** Овсянка на 100 г: 360 ккал, Б 12,5, Ж 6,2, У 60. */
const OATS: FoodProduct = { id: "oats", name: "Овсянка", brand: null, unit: "G", amountX10: 1000, kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600, revision: 1, archivedAt: null };
const entry = (override: DiaryEntry["override"] = null): DiaryEntry => {
  const snapshot = snapshotOfFood(OATS, 500);
  return { id: "e", clientId: "c", localDate: "2026-10-20", slot: "BREAKFAST", position: 0, revision: 1, snapshot, override, catalogEaten: snapshot.eaten };
};
const untouched: FieldEdits = { kcalX10: { touched: false, valueX10: null }, proteinX10: { touched: false, valueX10: null }, fatX10: { touched: false, valueX10: null }, carbsX10: { touched: false, valueX10: null } };
const touch = (key: keyof FieldEdits, valueX10: number | null): FieldEdits => ({ ...untouched, [key]: { touched: true, valueX10 } });

test("NUT-FS-29: правится только тронутое поле; остальные остаются по каталогу (null = не правилось)", () => {
  assert.deepEqual(planOverride(entry(), 500, touch("kcalX10", 2000)), { kcalX10: 2000, proteinX10: null, fatX10: null, carbsX10: null });
  assert.equal(planOverride(entry(), 500, untouched), null, "ничего не менялось — запись не трогаем");
});

test("значение, равное каталожному (50 г: Б 6,3 г), не создаёт правку; пустое тронутое поле у записи без правки — тоже", () => {
  assert.equal(planOverride(entry(), 500, touch("proteinX10", 63)), null);
  assert.equal(planOverride(entry(), 500, touch("fatX10", null)), null);
});

test("смена массы без правки полей — правка масштабируется сама (null); тронутое поле при новой массе дополняет прежнюю правку её действующим значением", () => {
  const edited = entry({ baseQuantityX10: 500, values: { kcalX10: 2000, proteinX10: null, fatX10: null, carbsX10: null } });
  assert.equal(planOverride(edited, 1000, untouched), null, "масштабирование считается при чтении, переписывать нечего");
  assert.deepEqual(planOverride(edited, 1000, touch("proteinX10", 2000)), { kcalX10: 4000, proteinX10: 2000, fatX10: null, carbsX10: null },
    "прежняя правка калорий на 100 г = 2000×2, белок задан тренером");
});

test("очистка единственной правки возвращает значения каталога («CLEAR»); очистка одной из двух оставляет вторую", () => {
  const one = entry({ baseQuantityX10: 500, values: { kcalX10: 2000, proteinX10: null, fatX10: null, carbsX10: null } });
  assert.equal(planOverride(one, 500, touch("kcalX10", null)), "CLEAR");
  const two = entry({ baseQuantityX10: 500, values: { kcalX10: 2000, proteinX10: 70, fatX10: null, carbsX10: null } });
  assert.deepEqual(planOverride(two, 500, touch("kcalX10", null)), { kcalX10: null, proteinX10: 70, fatX10: null, carbsX10: null });
});

test("явный ноль — осознанная правка, а не «нет данных»", () => {
  assert.deepEqual(planOverride(entry(), 500, touch("fatX10", 0)), { kcalX10: null, proteinX10: null, fatX10: 0, carbsX10: null });
});
