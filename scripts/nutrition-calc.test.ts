import assert from "node:assert/strict";
import test from "node:test";
import { calcEat, calcMacros, calcNeat, calcRee, deriveCalc, goalDelta, rebalanceMacroRanges, rebalanceMacros, type CalcProfile } from "../apps/mobile/src/features/nutrition/domain/CalcRules.ts";

/** Профиль экрана «Расчёт» из спецификации и скриншотов Build 120: муж., 37 лет, 181 см, умеренный образ жизни, 3 тренировки по 60 мин, средняя интенсивность. */
const PROFILE: CalcProfile = { goal: "MAINTENANCE", activity: "MODERATE", workoutsPerWeek: 3, minutes: 60, intensity: "MEDIUM", stepKcal: 100 };
/** Данные карточки клиента и замеров: пол, возраст, рост — из карточки. */
const BODY = { sex: "MALE", age: 37, heightCm: 181 } as const;

test("спецификация «Расчёт»: вес 85,35 кг, жир 20,4 % → REE 1837, NEAT 260, EAT 192, стартовый расход и итог 2289", () => {
  const result = deriveCalc(PROFILE, { ...BODY, weightKg: 85.35, fatPercent: 20.4, avgSteps: null });
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
  const loss = deriveCalc({ ...PROFILE, goal: "LOSS" }, { ...BODY, weightKg: 85.35, fatPercent: 20.4, avgSteps: null });
  assert.equal(loss.target, 2189);
});

test("итоги неизвестны, пока не хватает данных: нет веса — всё null, нет REE — нет стартового расхода", () => {
  const empty = deriveCalc(PROFILE, { ...BODY, weightKg: null, fatPercent: null, avgSteps: null });
  assert.deepEqual([empty.ree, empty.eat, empty.startTdee, empty.target], [null, null, null, null]);
  assert.equal(empty.neat, 260, "NEAT по образу жизни известен и без веса");
  const noSex = deriveCalc(PROFILE, { ...BODY, sex: null, weightKg: 85, fatPercent: null, avgSteps: null });
  assert.equal(noSex.ree, null);
  assert.equal(noSex.startTdee, null);
});

test("БЖУ при поддержании 2289 ккал и сухой массе 67,9 кг: Б 115, Ж 54, У 336 (значения с экрана Build 120)", () => {
  assert.deepEqual(calcMacros(67.9, 2289, "MAINTENANCE"), { protein: 115, fat: 54, carbs: 336 });
  assert.deepEqual(calcMacros(null, 2289, "MAINTENANCE"), { protein: null, fat: null, carbs: null });
  assert.equal(calcMacros(67.9, 2289, "GAIN").protein, 136, "2,0 г на кг сухой массы");
  assert.equal(calcMacros(67.9, 2289, "LOSS").protein, 143, "2,1 г на кг сухой массы");
});

test("формулы 2.0 (applyManualMacros/calcCorrMacros): введённые тренером значения фиксируются, остальное пересчитывается так, чтобы попасть в 2289 ккал", () => {
  const defaults = { protein: 115, fat: 54, carbs: 336 };
  const none = { protein: null, fat: null, carbs: null };
  assert.deepEqual(rebalanceMacros(2289, defaults, none), defaults, "ничего не введено — расчётные значения");
  assert.deepEqual(rebalanceMacros(2289, defaults, { ...none, protein: 140 }), { protein: 140, fat: 54, carbs: 311 }, "белок 140: жир по расчёту, углеводы добирают: (2289−560−486)/4 = 310,75");
  assert.deepEqual(rebalanceMacros(2289, defaults, { ...none, fat: 70 }), { protein: 115, fat: 70, carbs: 300 }, "жир 70: (2289−460−630)/4 = 299,75");
  assert.deepEqual(rebalanceMacros(2289, defaults, { ...none, carbs: 300 }), { protein: 115, fat: 70, carbs: 300 }, "углеводы 300 остаются как введены, жир добирает: (2289−460−1200)/9 = 69,9");
  assert.deepEqual(rebalanceMacros(2289, defaults, { protein: 140, fat: 70, carbs: null }), { protein: 140, fat: 70, carbs: 275 }, "Б и Ж введены — углеводы: (2289−560−630)/4 = 274,75");
  assert.deepEqual(rebalanceMacros(2289, defaults, { protein: 140, fat: null, carbs: 300 }), { protein: 140, fat: 59, carbs: 300 }, "Б и У введены — жир: (2289−560−1200)/9 = 58,8");
  assert.deepEqual(rebalanceMacros(2289, defaults, { protein: null, fat: 70, carbs: 300 }), { protein: 115, fat: 70, carbs: 300 }, "Ж и У введены — белок: (2289−630−1200)/4 = 114,75");
  assert.deepEqual(rebalanceMacros(2289, defaults, { protein: 140, fat: 70, carbs: 300 }), { protein: 140, fat: 70, carbs: 300 }, "все три введены — ровно как введены");
});

test("пересчёт макро: отрицательный остаток — 0; без калорий или расчётных значений недостающее неизвестно (null), а не выдуманное", () => {
  const defaults = { protein: 115, fat: 54, carbs: 336 };
  const none = { protein: null, fat: null, carbs: null };
  assert.deepEqual(rebalanceMacros(2289, defaults, { ...none, protein: 600 }), { protein: 600, fat: 54, carbs: 0 }, "(2289−2400−486)/4 < 0 → 0");
  assert.deepEqual(rebalanceMacros(null, defaults, { protein: 140, fat: 70, carbs: null }), { protein: 140, fat: 70, carbs: null }, "калорийного ориентира нет — недостающее не считается");
  assert.deepEqual(rebalanceMacros(2289, none, { ...none, protein: 140 }), { protein: 140, fat: null, carbs: null }, "нет сухой массы — расчётного жира нет, углеводы не определить");
  assert.deepEqual(rebalanceMacros(2289, none, { protein: 140, fat: 70, carbs: null }), { protein: 140, fat: 70, carbs: 275 }, "две введённые не нуждаются в расчётных значениях");
});

test("пересчёт при диапазонах (режим «Коридор»): досчитанный показатель получает коридор, в котором 2289 ккал достижимы при любых значениях введённого диапазона", () => {
  const defaults = { protein: 115, fat: 54, carbs: 336 };
  const point = (value: number) => ({ min: value, max: value });
  const none = { protein: null, fat: null, carbs: null };
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, { ...none, protein: { min: 130, max: 150 } }),
    { protein: { min: 130, max: 150 }, fat: point(54), carbs: { min: 301, max: 321 } }, "углеводы: [(2289−4·150−9·54)/4; (2289−4·130−9·54)/4] = [300,75; 320,75]");
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, { ...none, fat: { min: 60, max: 80 } }),
    { protein: point(115), fat: { min: 60, max: 80 }, carbs: { min: 277, max: 322 } }, "[(2289−460−720)/4; (2289−460−540)/4] = [277,25; 322,25]");
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, { ...none, carbs: { min: 280, max: 320 } }),
    { protein: point(115), fat: { min: 61, max: 79 }, carbs: { min: 280, max: 320 } }, "жир: [(2289−460−1280)/9; (2289−460−1120)/9] = [61,0; 78,8]");
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, { protein: { min: 130, max: 150 }, fat: { min: 50, max: 60 }, carbs: null }),
    { protein: { min: 130, max: 150 }, fat: { min: 50, max: 60 }, carbs: { min: 287, max: 330 } }, "углеводы: [(2289−600−540)/4; (2289−520−450)/4] = [287,25; 329,75]");
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, { protein: { min: 130, max: 150 }, fat: null, carbs: { min: 300, max: 320 } }).fat, { min: 45, max: 63 });
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, { protein: null, fat: { min: 50, max: 60 }, carbs: { min: 300, max: 320 } }).protein, { min: 117, max: 160 });
});

test("пересчёт при диапазонах: точные числа дают то же, что режим «Точное значение»; остаток не ниже 0; без калорий или расчёта — null", () => {
  const defaults = { protein: 115, fat: 54, carbs: 336 };
  const none = { protein: null, fat: null, carbs: null };
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, { ...none, protein: { min: 140, max: 140 } }),
    { protein: { min: 140, max: 140 }, fat: { min: 54, max: 54 }, carbs: { min: 311, max: 311 } }, "как rebalanceMacros: Б 140 → Ж 54, У 311");
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, { ...none, protein: { min: 500, max: 600 } }).carbs, { min: 0, max: 0 }, "отрицательный остаток — 0");
  assert.deepEqual(rebalanceMacroRanges(2289, defaults, none), { protein: { min: 115, max: 115 }, fat: { min: 54, max: 54 }, carbs: { min: 336, max: 336 } }, "ничего не введено — расчётные числа");
  assert.deepEqual(rebalanceMacroRanges(null, defaults, { ...none, protein: { min: 130, max: 150 } }).carbs, null, "калорийного ориентира нет");
  assert.deepEqual(rebalanceMacroRanges(2289, { protein: null, fat: null, carbs: null }, { ...none, protein: { min: 130, max: 150 } }).fat, null, "нет сухой массы — жира по расчёту нет");
});

test("Б/Ж/У без процента жира: масса для белка и жира — 80 % веса (как в 2.0); с процентом жира — сухая масса", () => {
  const profile = { goal: "MAINTENANCE", activity: "MODERATE", workoutsPerWeek: 0, minutes: 60, intensity: "MEDIUM", stepKcal: 100 } as const;
  const body = { sex: "MALE", age: 37, heightCm: 181, avgSteps: null } as const;
  const noFat = deriveCalc(profile, { ...body, weightKg: 85.4, fatPercent: null });
  assert.equal(noFat.startTdee, 2065, "Миффлин 1805 + NEAT 260 + EAT 0");
  assert.equal(noFat.macroMassKg, 68.3, "85,4 × 0,8");
  assert.deepEqual(calcMacros(noFat.macroMassKg, noFat.target, "MAINTENANCE"), { protein: 116, fat: 55, carbs: 277 }, "Б 68,3×1,7; Ж 68,3×0,8; У = (2065 − 464 − 495) / 4 = 276,5");
  const withFat = deriveCalc(profile, { ...body, weightKg: 85.35, fatPercent: 20.4 });
  assert.equal(withFat.macroMassKg, 67.9, "известный % жира — сухая масса, а не 80 %");
  assert.equal(deriveCalc(profile, { ...body, weightKg: null, fatPercent: null }).macroMassKg, null, "веса нет — массы нет");
});
