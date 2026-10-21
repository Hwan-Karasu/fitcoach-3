import assert from "node:assert/strict";
import test from "node:test";
import { deriveHomeMacroTarget, homeAdjustmentFor, EMPTY_MANUAL_MACROS } from "../apps/mobile/src/features/nutrition/domain/HomeMacroTargets.ts";
import { navyBodyFat } from "../apps/mobile/src/features/measurements/domain/NavyBodyFat.ts";
import { calcEat, calcMacros, calcNeat, calcRee, deriveCalc, goalDelta, pointMacroRanges, rebalanceMacroRanges, rebalanceMacros, type CalcProfile } from "../apps/mobile/src/features/nutrition/domain/CalcRules.ts";

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

test("БЖУ при поддержании 2289 ккал и сухой массе 67,9 кг: Б 115, Ж 54,4, У 334,9", () => {
  assert.deepEqual(calcMacros(67.9, 2289, "MAINTENANCE"), { protein: 115, fat: 54.4, carbs: 334.9 });
  assert.deepEqual(calcMacros(null, 2289, "MAINTENANCE"), { protein: null, fat: null, carbs: null });
  assert.equal(calcMacros(67.9, 2289, "GAIN").protein, 136, "2,0 г на кг сухой массы");
  assert.equal(calcMacros(67.9, 2289, "LOSS").protein, 143, "2,1 г на кг сухой массы");
});

const DEFAULTS = { protein: 119, fat: 56, carbs: 355 };
const NONE = { protein: null, fat: null, carbs: null };
const point = (grams: number) => ({ minX10: Math.round(grams * 10), maxX10: Math.round(grams * 10) });
const range = (min: number, max: number) => ({ minX10: min * 10, maxX10: max * 10 });
const gramsRange = (min: number, max = min) => ({ min, max });
const balance = (manual: typeof NONE | { protein: number | null; fat: number | null; carbs: number | null }) => rebalanceMacros(2400, DEFAULTS, manual, 70);

test("один ручной нутриент: жир сохраняется до последнего, калории добираются углеводами или белком", () => {
  assert.deepEqual(balance(NONE), DEFAULTS);
  assert.deepEqual(balance({ ...NONE, protein: 150 }), { protein: 150, fat: 56, carbs: 324 });
  assert.deepEqual(balance({ ...NONE, fat: 80 }), { protein: 119, fat: 80, carbs: 301 });
  assert.deepEqual(balance({ ...NONE, carbs: 300 }), { protein: 174, fat: 56, carbs: 300 });
});

test("два нутриента: третий по остатку; три — ровно ручной ввод", () => {
  assert.deepEqual(balance({ protein: 150, fat: 60, carbs: null }), { protein: 150, fat: 60, carbs: 315 });
  assert.deepEqual(balance({ protein: 150, fat: null, carbs: 300 }), { protein: 150, fat: 66.7, carbs: 300 });
  assert.deepEqual(balance({ protein: null, fat: 60, carbs: 300 }), { protein: 165, fat: 60, carbs: 300 });
  assert.deepEqual(balance({ protein: 150, fat: 10, carbs: 300 }), { protein: 150, fat: 10, carbs: 300 });
});

test("отрицательный остаток и жир за границами — конфликт до округления", () => {
  assert.throws(() => balance({ ...NONE, protein: 600 }), /MACRO_NEGATIVE_REMAINDER/u);
  assert.throws(() => balance({ protein: 150, fat: null, carbs: 330 }), /MACRO_FAT_RANGE/u);
  assert.throws(() => balance({ protein: 150, fat: null, carbs: 290 }), /MACRO_FAT_RANGE/u);
  assert.equal(balance({ protein: 150, fat: null, carbs: 324 }).fat, 56, "нижняя граница 0,8 г/кг включена");
  assert.equal(balance({ protein: 150, fat: null, carbs: 292.5 }).fat, 70, "верхняя граница 1 г/кг включена");
  assert.throws(() => balance({ protein: 150, fat: null, carbs: 324.1 }), /MACRO_FAT_RANGE/u, "не маскировать ошибку округлением");
});

test("коридоры: весь диапазон должен давать допустимый остаток", () => {
  const rebalance = (manual: Parameters<typeof rebalanceMacroRanges>[2]) => rebalanceMacroRanges(2400, pointMacroRanges(DEFAULTS), manual, 70);
  assert.deepEqual(rebalance({ protein: gramsRange(140, 150), fat: null, carbs: null }),
    { protein: gramsRange(140, 150), fat: gramsRange(56), carbs: gramsRange(324, 334) });
  assert.deepEqual(rebalance({ protein: null, fat: gramsRange(60, 70), carbs: null }).carbs, gramsRange(323.5, 346));
  assert.deepEqual(rebalance({ protein: null, fat: null, carbs: gramsRange(280, 320) }),
    { protein: gramsRange(154, 194), fat: gramsRange(56), carbs: gramsRange(280, 320) });
  assert.deepEqual(rebalance({ protein: gramsRange(145, 150), fat: null, carbs: gramsRange(300) }).fat, gramsRange(66.7, 68.9));
  assert.throws(() => rebalance({ protein: gramsRange(140, 150), fat: null, carbs: gramsRange(300, 325) }), /MACRO_FAT_RANGE/u);
  assert.throws(() => rebalance({ protein: gramsRange(150, 600), fat: null, carbs: null }), /MACRO_NEGATIVE_REMAINDER/u);
});

test("калорийный ориентир сохраняется с одним/двумя полями и меняется только с тремя", () => {
  for (const manual of [{ ...EMPTY_MANUAL_MACROS, protein: point(150) }, { protein: point(150), fat: point(60), carbs: null }]) {
    const result = deriveHomeMacroTarget(2401, DEFAULTS, 70, manual);
    assert.equal(result.problem, null);
    assert.deepEqual(result.corridors.kcal, point(2401), "не подменять ориентир суммой округлённых БЖУ");
  }
  const all = deriveHomeMacroTarget(2400, DEFAULTS, 70, { protein: point(150), fat: point(10), carbs: point(300) });
  assert.equal(all.problem, null, "ручной жир может выходить за диапазон");
  assert.deepEqual(all.corridors.kcal, point(1890));
  const ranged = deriveHomeMacroTarget(null, NONE, null, { protein: range(100, 120), fat: range(40, 50), carbs: range(200, 250) });
  assert.equal(ranged.problem, null);
  assert.deepEqual(ranged.corridors.kcal, range(1560, 1930));
});

test("недостаток исходных данных: прочерки, нет частичной суммы калорий; ручной ввод не теряется", () => {
  const auto = deriveHomeMacroTarget(2400, NONE, null, EMPTY_MANUAL_MACROS);
  assert.deepEqual(auto.corridors, { ...EMPTY_MANUAL_MACROS, kcal: point(2400) });
  assert.equal(auto.problem, null, "без процента жира — подсказка, а не ошибка");
  const partial = deriveHomeMacroTarget(null, NONE, null, { ...EMPTY_MANUAL_MACROS, protein: point(150) });
  assert.equal(partial.corridors.kcal, null);
  assert.deepEqual(partial.corridors.protein, point(150));
  assert.ok(partial.problem);
  assert.ok(deriveHomeMacroTarget(2400, NONE, null, { protein: point(150), fat: null, carbs: point(300) }).problem);
  const two = deriveHomeMacroTarget(2400, NONE, null, { protein: point(150), fat: point(60), carbs: null });
  assert.equal(two.problem, null, "при ручных Б и Ж для остатка У сухая масса не нужна");
  assert.deepEqual(two.corridors.carbs, point(315));
});

test("очистка полей возвращает автоматический расчёт; конфликт не меняет ручные поля и калории", () => {
  const conflict = deriveHomeMacroTarget(2400, DEFAULTS, 70, { protein: point(600), fat: null, carbs: null });
  assert.ok(conflict.problem);
  assert.deepEqual(conflict.corridors, { protein: point(600), fat: null, carbs: null, kcal: point(2400) });
  const reset = deriveHomeMacroTarget(2400, DEFAULTS, 70, EMPTY_MANUAL_MACROS);
  assert.equal(reset.problem, null);
  assert.deepEqual(reset.corridors, { kcal: point(2400), protein: point(119), fat: point(56), carbs: point(355) });
});

test("БЖУ без процента жира неизвестны; калории по Миффлину доступны; оценка ВМС даёт сухую массу", () => {
  const profile = { ...PROFILE, workoutsPerWeek: 0 };
  const inputs = { ...BODY, weightKg: 85.4, fatPercent: null, avgSteps: null };
  const noFat = deriveCalc(profile, inputs);
  assert.equal(noFat.target, 2065);
  assert.equal(noFat.macroMassKg, null);
  assert.deepEqual(calcMacros(noFat.macroMassKg, noFat.target, "MAINTENANCE"), NONE);
  const percent = navyBodyFat({ sex: "MALE", heightCm: 181, neckCm: 40, waistCm: 90, hipsCm: null });
  assert.ok(percent !== null);
  const withFat = deriveCalc(profile, { ...inputs, fatPercent: percent });
  assert.ok(withFat.macroMassKg !== null);
  const macros = calcMacros(withFat.macroMassKg, withFat.target, "MAINTENANCE");
  assert.ok(macros.fat! >= withFat.macroMassKg * 0.8);
  assert.ok(macros.fat! <= withFat.macroMassKg);
  assert.equal(deriveCalc(profile, { ...inputs, weightKg: null }).macroMassKg, null);
});

test("округление жира на дробной сухой массе остаётся внутри 0,8–1 г/кг", () => {
  for (const fat of [67.9 * 0.8, 67.9]) {
    const calories = 100 * 4 + 300 * 4 + fat * 9;
    const result = rebalanceMacros(calories, DEFAULTS, { protein: 100, fat: null, carbs: 300 }, 67.9);
    assert.ok(result.fat! >= 67.9 * 0.8 && result.fat! <= 67.9);
  }
  assert.equal(calcMacros(70, 100, "MAINTENANCE").carbs, null, "невозможный автоматический остаток не равен нулю");
});

test("старые цели 120/60/200 не подменяют формулу главной; восстанавливаются только новые ручные поля", () => {
  const legacy = { id: "old", clientId: "c", effectiveFrom: "2026-10-01", revision: 1,
    days: Array.from({ length: 7 }, () => ({ kcal: point(1820), protein: point(120), fat: point(60), carbs: point(200) })) };
  assert.equal(homeAdjustmentFor([legacy], "2026-10-20"), null);
  const calculated = deriveHomeMacroTarget(2400, DEFAULTS, 70, homeAdjustmentFor([legacy], "2026-10-20")?.manual ?? EMPTY_MANUAL_MACROS);
  assert.deepEqual(calculated.corridors, { kcal: point(2400), protein: point(119), fat: point(56), carbs: point(355) });
  const updated = { ...legacy, id: "new", effectiveFrom: "2026-10-20", homeAdjustment: { mode: "EXACT" as const, manual: { ...EMPTY_MANUAL_MACROS, protein: point(150) } } };
  assert.equal(homeAdjustmentFor([legacy, updated], "2026-10-19"), null, "будущая корректировка не применяется раньше даты");
  const restored = homeAdjustmentFor([legacy, updated], "2026-10-20");
  assert.deepEqual(restored?.manual, { protein: point(150), fat: null, carbs: null });
  assert.deepEqual(deriveHomeMacroTarget(2400, DEFAULTS, 70, restored!.manual).corridors,
    { kcal: point(2400), protein: point(150), fat: point(56), carbs: point(324) });
});

test("переключение Точно/Коридор меняет автоматические БЖУ без ручного ввода и не меняет калории", () => {
  const ranged = deriveHomeMacroTarget(2400, DEFAULTS, 70, EMPTY_MANUAL_MACROS, "RANGE");
  assert.equal(ranged.problem, null);
  assert.deepEqual(ranged.corridors, { kcal: point(2400), protein: range(107.1, 130.9), fat: range(56, 70), carbs: range(311.6, 366.9) });
  const exact = deriveHomeMacroTarget(2400, DEFAULTS, 70, EMPTY_MANUAL_MACROS, "EXACT");
  assert.deepEqual(exact.corridors, { kcal: point(2400), protein: point(119), fat: point(56), carbs: point(355) });
  assert.deepEqual(deriveHomeMacroTarget(2400, NONE, null, EMPTY_MANUAL_MACROS, "RANGE").corridors,
    { kcal: point(2400), protein: null, fat: null, carbs: null });
});

test("Коридор: ручной нутриент фиксируется, остальные автоматические значения остаются диапазонами", () => {
  const protein = deriveHomeMacroTarget(2400, DEFAULTS, 70, { ...EMPTY_MANUAL_MACROS, protein: point(150) }, "RANGE");
  assert.equal(protein.problem, null);
  assert.deepEqual(protein.corridors, { kcal: point(2400), protein: point(150), fat: range(56, 70), carbs: range(292.5, 324) });
  const fat = deriveHomeMacroTarget(2400, DEFAULTS, 70, { ...EMPTY_MANUAL_MACROS, fat: point(60) }, "RANGE");
  assert.equal(fat.problem, null);
  assert.deepEqual(fat.corridors, { kcal: point(2400), protein: range(107.1, 130.9), fat: point(60), carbs: range(334.1, 357.9) });
  const carbs = deriveHomeMacroTarget(2400, DEFAULTS, 70, { ...EMPTY_MANUAL_MACROS, carbs: point(300) }, "RANGE");
  assert.equal(carbs.problem, null);
  assert.deepEqual(carbs.corridors, { kcal: point(2400), protein: range(142.5, 174), fat: range(56, 70), carbs: point(300) });
  const conflict = deriveHomeMacroTarget(2400, DEFAULTS, 70, { ...EMPTY_MANUAL_MACROS, carbs: point(500) }, "RANGE");
  assert.ok(conflict.problem);
  assert.deepEqual(conflict.corridors.kcal, point(2400));
});
