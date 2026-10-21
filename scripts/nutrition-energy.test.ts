import assert from "node:assert/strict";
import test from "node:test";
import { kcalFromMacrosX10, kcalIsDerived, kcalRangeFromMacros } from "../apps/mobile/src/features/nutrition/domain/EnergyRules.ts";

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

test("NUT-005: калории продукта, совпавшие с 4/9/4 по Б/Ж/У, считаются авто; свои и неполные — нет", () => {
  assert.equal(kcalIsDerived({ kcalX10: 17750, proteinX10: 1400, fatX10: 550, carbsX10: 1800 }), true, "4·140 + 9·55 + 4·180 = 1775 ккал");
  assert.equal(kcalIsDerived({ kcalX10: 17000, proteinX10: 1400, fatX10: 550, carbsX10: 1800 }), false, "введены вручную");
  assert.equal(kcalIsDerived({ kcalX10: 3600, proteinX10: 125, fatX10: null, carbsX10: 600 }), false, "жир неизвестен — авторасчёта нет");
  assert.equal(kcalIsDerived({ kcalX10: null, proteinX10: 125, fatX10: 62, carbsX10: 600 }), false, "калорий нет");
});
