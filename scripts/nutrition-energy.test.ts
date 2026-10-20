import assert from "node:assert/strict";
import test from "node:test";
import { kcalFromMacrosX10, kcalRangeFromEntered, kcalRangeFromMacros } from "../apps/mobile/src/features/nutrition/domain/EnergyRules.ts";

test("калории считаются сами: 1 г белка = 4 ккал, жира = 9 ккал, углеводов = 4 ккал (значения в десятых долях)", () => {
  assert.equal(kcalFromMacrosX10({ proteinX10: 1400, fatX10: 550, carbsX10: 1800 }), 17750, "4·140 + 9·55 + 4·180 = 1775 ккал");
  assert.equal(kcalFromMacrosX10({ proteinX10: 10, fatX10: 0, carbsX10: 0 }), 40, "1 г белка = 4 ккал");
  assert.equal(kcalFromMacrosX10({ proteinX10: 0, fatX10: 10, carbsX10: 0 }), 90, "1 г жира = 9 ккал");
  assert.equal(kcalFromMacrosX10({ proteinX10: 0, fatX10: 0, carbsX10: 10 }), 40, "1 г углеводов = 4 ккал");
  assert.equal(kcalFromMacrosX10({ proteinX10: 125, fatX10: 62, carbsX10: 600 }), 3458, "овсянка на 100 г: 4·12,5 + 9·6,2 + 4·60 = 345,8 ккал");
});

test("неполные данные не дают калорий: нет любого из Б/Ж/У — null, а не сумма «что есть»", () => {
  assert.equal(kcalFromMacrosX10({ proteinX10: 1400, fatX10: null, carbsX10: 1800 }), null);
  assert.equal(kcalFromMacrosX10({ proteinX10: null, fatX10: null, carbsX10: null }), null);
  assert.equal(kcalFromMacrosX10({ proteinX10: 0, fatX10: 0, carbsX10: 0 }), 0, "явные нули — известные нули");
});

test("диапазон калорий из диапазонов Б/Ж/У: нижняя из нижних, верхняя из верхних; целое число ккал", () => {
  const range = kcalRangeFromMacros({ protein: { minX10: 1400, maxX10: 1600 }, fat: { minX10: 550, maxX10: 700 }, carbs: { minX10: 1800, maxX10: 2200 } });
  assert.deepEqual(range, { minX10: 17750, maxX10: 21500 }, "1775–2150 ккал");
  assert.deepEqual(kcalRangeFromMacros({ protein: { minX10: 125, maxX10: 125 }, fat: { minX10: 62, maxX10: 62 }, carbs: { minX10: 600, maxX10: 600 } }), { minX10: 3460, maxX10: 3460 }, "345,8 → 346 ккал целым");
  assert.equal(kcalRangeFromMacros({ protein: { minX10: 1400, maxX10: 1600 }, fat: null, carbs: { minX10: 1800, maxX10: 2200 } }), null);
});

test("калории от введённого: даже один белок даёт ккал (4/9/4 по тому, что введено); диапазоны суммируются по границам; ничего не введено — null", () => {
  const range = (min: number, max: number) => ({ minX10: min * 10, maxX10: max * 10 });
  assert.deepEqual(kcalRangeFromEntered({ protein: range(100, 100), fat: null, carbs: null }), { minX10: 4000, maxX10: 4000 }, "только белок 100 г = 400 ккал");
  assert.deepEqual(kcalRangeFromEntered({ protein: range(100, 100), fat: range(60, 60), carbs: null }), { minX10: 9400, maxX10: 9400 }, "400 + 540 = 940 ккал");
  assert.deepEqual(kcalRangeFromEntered({ protein: range(100, 100), fat: range(60, 60), carbs: range(200, 200) }), { minX10: 17400, maxX10: 17400 }, "400 + 540 + 800 = 1740 ккал");
  assert.deepEqual(kcalRangeFromEntered({ protein: range(90, 110), fat: null, carbs: null }), { minX10: 3600, maxX10: 4400 }, "диапазон белка 90–110 г = 360–440 ккал");
  assert.equal(kcalRangeFromEntered({ protein: null, fat: null, carbs: null }), null);
});
