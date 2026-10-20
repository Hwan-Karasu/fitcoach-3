import assert from "node:assert/strict";
import test from "node:test";
import { calcEat, calcMacros, calcNeat, calcRee, deriveCalc, goalDelta, proposeCorridors, type CalcProfile } from "../apps/mobile/src/features/nutrition/domain/CalcRules.ts";

/** Профиль экрана «Расчёт» из спецификации и скриншотов Build 120: муж., 37 лет, 181 см, умеренный образ жизни, 3 тренировки по 60 мин, средняя интенсивность. */
const PROFILE: CalcProfile = { sex: "MALE", age: 37, heightCm: 181, goal: "MAINTENANCE", activity: "MODERATE", workoutsPerWeek: 3, minutes: 60, intensity: "MEDIUM", stepKcal: 100 };

test("спецификация «Расчёт»: вес 85,35 кг, жир 20,4 % → REE 1837, NEAT 260, EAT 192, стартовый расход и итог 2289", () => {
  const result = deriveCalc(PROFILE, { weightKg: 85.35, fatPercent: 20.4, avgSteps: null });
  assert.equal(result.ree, 1837, "Кэтч–Макардл: 370 + 21,6 × 67,9 кг сухой массы");
  assert.equal(result.neat, 260);
  assert.equal(result.neatSource, "ACTIVITY");
  assert.equal(result.eat, 192);
  assert.equal(result.startTdee, 2289);
  assert.equal(result.target, 2289, "поддержание: поправка 0");
});

test("REE: Миффлин–Сан-Жеор без % жира — мужчина 1795, женщина 1320; неполные данные — null, а не 0", () => {
  assert.equal(calcRee("MALE", 37, 180, 85, null), 1795, "10·85 + 6,25·180 − 5·37 + 5");
  assert.equal(calcRee("FEMALE", 30, 165, 60, null), 1320, "600 + 1031,25 − 150 − 161 = 1320,25");
  assert.equal(calcRee(null, 37, 180, 85, null), null, "пол не выбран");
  assert.equal(calcRee("MALE", null, 180, 85, null), null);
  assert.equal(calcRee("MALE", 37, 180, null, null), null);
  assert.equal(calcRee(null, null, null, 85, 67.9), 1837, "при известной сухой массе пол и рост не нужны");
});

test("NEAT: по шагам 8000 при 85 кг = 306; без шагов — по образу жизни 180/260/360/460", () => {
  assert.equal(calcNeat(8000, 85, "MODERATE"), 306, "85 × 0,00045 = 0,03825 ккал на шаг");
  assert.equal(calcNeat(null, 85, "SEDENTARY"), 180);
  assert.equal(calcNeat(null, null, "MODERATE"), 260);
  assert.equal(calcNeat(null, 85, "ACTIVE"), 360);
  assert.equal(calcNeat(null, 85, "VERY_ACTIVE"), 460);
  assert.equal(calcNeat(8000, 200, "MODERATE"), 480, "верхняя граница 0,06 ккал на шаг");
  assert.equal(calcNeat(8000, 50, "MODERATE"), 240, "нижняя граница 0,03 ккал на шаг");
});

test("EAT: нет тренировок — 0, вес неизвестен — null; лёгкая интенсивность 134", () => {
  assert.equal(calcEat(85.35, 0, 60, "MEDIUM"), 0);
  assert.equal(calcEat(null, 3, 60, "MEDIUM"), null);
  assert.equal(calcEat(85.35, 3, 60, "LIGHT"), 134);
});

test("цель: поправка на «шаг цели» — похудение −100, набор +100, поддержание 0", () => {
  assert.equal(goalDelta("LOSS", 100), -100);
  assert.equal(goalDelta("GAIN", 100), 100);
  assert.equal(goalDelta("MAINTENANCE", 100), 0);
  assert.equal(goalDelta("LOSS", -50), -50, "знак шага не важен");
  const loss = deriveCalc({ ...PROFILE, goal: "LOSS" }, { weightKg: 85.35, fatPercent: 20.4, avgSteps: null });
  assert.equal(loss.target, 2189);
});

test("итоги неизвестны, пока не хватает данных: нет веса — всё null, нет REE — нет стартового расхода", () => {
  const empty = deriveCalc(PROFILE, { weightKg: null, fatPercent: null, avgSteps: null });
  assert.deepEqual([empty.ree, empty.eat, empty.startTdee, empty.target], [null, null, null, null]);
  assert.equal(empty.neat, 260, "NEAT по образу жизни известен и без веса");
  const noSex = deriveCalc({ ...PROFILE, sex: null }, { weightKg: 85, fatPercent: null, avgSteps: null });
  assert.equal(noSex.ree, null);
  assert.equal(noSex.startTdee, null);
});

test("БЖУ при поддержании 2289 ккал и сухой массе 67,9 кг: Б 115, Ж 54, У 336 (значения с экрана Build 120)", () => {
  assert.deepEqual(calcMacros(67.9, 2289, "MAINTENANCE"), { protein: 115, fat: 54, carbs: 336 });
  assert.deepEqual(calcMacros(null, 2289, "MAINTENANCE"), { protein: null, fat: null, carbs: null });
  assert.equal(calcMacros(67.9, 2289, "GAIN").protein, 136, "2,0 г на кг сухой массы");
  assert.equal(calcMacros(67.9, 2289, "LOSS").protein, 143, "2,1 г на кг сухой массы");
});

test("§49.10: предложенные коридоры — ±5 % ккал и ±10 % Б/Ж/У вокруг расчёта, значения в десятых долях", () => {
  const corridors = proposeCorridors(2289, { protein: 115, fat: 54, carbs: 336 }, { kcalPercent: 5, macroPercent: 10 });
  assert.deepEqual(corridors.kcal, { minX10: 21746, maxX10: 24035 }, "2174,55 и 2403,45 → округление до десятых");
  assert.deepEqual(corridors.protein, { minX10: 1035, maxX10: 1265 });
  assert.deepEqual(corridors.fat, { minX10: 486, maxX10: 594 });
  assert.deepEqual(corridors.carbs, { minX10: 3024, maxX10: 3696 });
  const partial = proposeCorridors(null, { protein: null, fat: null, carbs: null }, { kcalPercent: 5, macroPercent: 10 });
  assert.deepEqual(partial, { kcal: null, protein: null, fat: null, carbs: null }, "без расчёта цели не выдумываются");
});
