import type { Corridors, TargetRange } from "./TargetModel.ts";

/**
 * Расчёт КБЖУ (§49.10, П6): оценка суточного расхода и предложение коридоров. Результат — черновик, а не действующая цель; неполные
 * исходные данные дают `null`, а не нулевые или выдуманные значения. Формулы — те же, что в FitCoach 2.0 Build 120 (решение владельца
 * 2026-10-20), переписанные заново; вес и % жира приходят из Measurements, шаги — из суточной активности.
 */
export type CalcSex = "MALE" | "FEMALE";
export type CalcGoal = "LOSS" | "MAINTENANCE" | "GAIN";
export type CalcActivity = "SEDENTARY" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
export type CalcIntensity = "LIGHT" | "MEDIUM" | "HEAVY";

export const CALC_GOALS: readonly CalcGoal[] = ["LOSS", "MAINTENANCE", "GAIN"];
export const CALC_ACTIVITIES: readonly CalcActivity[] = ["SEDENTARY", "MODERATE", "ACTIVE", "VERY_ACTIVE"];
export const CALC_INTENSITIES: readonly CalcIntensity[] = ["LIGHT", "MEDIUM", "HEAVY"];

/** Параметры профиля, которые тренер вводит на экране «Расчёт». Вес и % жира сюда не входят: источник — Measurements. */
export interface CalcProfile {
  readonly sex: CalcSex | null;
  readonly age: number | null;
  readonly heightCm: number | null;
  readonly goal: CalcGoal;
  readonly activity: CalcActivity;
  readonly workoutsPerWeek: number;
  readonly minutes: number;
  readonly intensity: CalcIntensity;
  /** «Шаг цели», ккал: величина поправки для похудения и набора. */
  readonly stepKcal: number;
}

export interface CalcInputs {
  readonly weightKg: number | null;
  readonly fatPercent: number | null;
  /** Средние шаги в день по дням с известными шагами; `null` — шагов нет. */
  readonly avgSteps: number | null;
}

export interface CalcResult {
  readonly leanMassKg: number | null;
  readonly ree: number | null;
  readonly neat: number | null;
  readonly neatSource: "STEPS" | "ACTIVITY";
  readonly eat: number | null;
  /** REE + NEAT + EAT; `null`, пока неизвестна любая часть. */
  readonly startTdee: number | null;
  readonly goalDelta: number;
  readonly target: number | null;
}

const positive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

/** Сухая масса, кг с десятой: вес × (1 − % жира); без веса или при недопустимом % жира — `null`. */
export function leanMass(weightKg: number | null, fatPercent: number | null): number | null {
  if (!positive(weightKg) || !positive(fatPercent) || fatPercent >= 100) return null;
  return Math.round(weightKg * (1 - fatPercent / 100) * 10) / 10;
}

/** Кэтч–Макардл при известной сухой массе, иначе Миффлин–Сан-Жеор; без нужных данных — `null`. */
export function calcRee(sex: CalcSex | null, age: number | null, heightCm: number | null, weightKg: number | null, lean: number | null): number | null {
  if (positive(lean)) return Math.round(370 + 21.6 * lean);
  if (sex === null || !positive(age) || !positive(heightCm) || !positive(weightKg)) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === "MALE" ? base + 5 : base - 161);
}

const NEAT_BY_ACTIVITY: Readonly<Record<CalcActivity, number>> = { SEDENTARY: 180, MODERATE: 260, ACTIVE: 360, VERY_ACTIVE: 460 };

/** Повседневная активность: по средним шагам и весу (0,03–0,06 ккал на шаг), иначе по выбранному образу жизни. */
export function calcNeat(avgSteps: number | null, weightKg: number | null, activity: CalcActivity): number {
  if (positive(avgSteps) && positive(weightKg)) return Math.round(avgSteps * Math.min(0.06, Math.max(0.03, weightKg * 0.00045)));
  return NEAT_BY_ACTIVITY[activity];
}

const MET: Readonly<Record<CalcIntensity, number>> = { LIGHT: 3.5, MEDIUM: 5, HEAVY: 6 };

/** Тренировочные затраты в среднем за сутки: MET × 3,5 × вес / 200 × минуты × тренировок в неделю / 7. */
export function calcEat(weightKg: number | null, workoutsPerWeek: number, minutes: number, intensity: CalcIntensity): number | null {
  if (!positive(weightKg)) return null;
  if (!positive(workoutsPerWeek)) return 0;
  const perSession = ((MET[intensity] * 3.5 * weightKg) / 200) * (positive(minutes) ? minutes : 60);
  return Math.round((perSession * workoutsPerWeek) / 7);
}

/** Поправка калорий на цель: похудение — вычесть шаг, набор — прибавить, поддержание — 0. */
export function goalDelta(goal: CalcGoal, stepKcal: number): number {
  const step = Math.abs(Number.isFinite(stepKcal) ? stepKcal : 0);
  return goal === "LOSS" ? -step : goal === "GAIN" ? step : 0;
}

export function deriveCalc(profile: CalcProfile, inputs: CalcInputs): CalcResult {
  const lean = leanMass(inputs.weightKg, inputs.fatPercent);
  const ree = calcRee(profile.sex, profile.age, profile.heightCm, inputs.weightKg, lean);
  const fromSteps = positive(inputs.avgSteps) && positive(inputs.weightKg);
  const neat = calcNeat(inputs.avgSteps, inputs.weightKg, profile.activity);
  const eat = calcEat(inputs.weightKg, profile.workoutsPerWeek, profile.minutes, profile.intensity);
  const startTdee = ree !== null && eat !== null ? Math.round(ree + neat + eat) : null;
  const delta = goalDelta(profile.goal, profile.stepKcal);
  return { leanMassKg: lean, ree, neat, neatSource: fromSteps ? "STEPS" : "ACTIVITY", eat, startTdee, goalDelta: delta, target: startTdee === null ? null : startTdee + delta };
}

export interface MacroGrams {
  readonly protein: number | null;
  readonly fat: number | null;
  readonly carbs: number | null;
}

/** Белок 1,7 / 2,0 / 2,1 г и жир 0,8 г на кг сухой массы; углеводы — остаток калорий. Без сухой массы или калорий — `null`. */
export function calcMacros(leanMassKg: number | null, calories: number | null, goal: CalcGoal): MacroGrams {
  if (!positive(leanMassKg) || !positive(calories)) return { protein: null, fat: null, carbs: null };
  const protein = Math.round(leanMassKg * (goal === "MAINTENANCE" ? 1.7 : goal === "GAIN" ? 2 : 2.1));
  const fat = Math.round(leanMassKg * 0.8);
  return { protein, fat, carbs: Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4)) };
}

export interface Tolerance {
  readonly kcalPercent: number;
  readonly macroPercent: number;
}

/** Допуск по умолчанию (решение реализации, не медицинский стандарт §49.10.6): виден и правится тренером до «Применить». */
export const DEFAULT_TOLERANCE: Tolerance = { kcalPercent: 5, macroPercent: 10 };

const around = (value: number | null, percent: number): TargetRange | null => {
  if (value === null) return null;
  return { minX10: Math.round((value * 10 * (100 - percent)) / 100), maxX10: Math.round((value * 10 * (100 + percent)) / 100) };
};

/** Расчётные ориентиры → коридоры `min–max` в десятых долях. Показатель без расчёта остаётся без цели (`null`), а не «0–0». */
export function proposeCorridors(kcal: number | null, macros: MacroGrams, tolerance: Tolerance): Corridors {
  return { kcal: around(kcal, tolerance.kcalPercent), protein: around(macros.protein, tolerance.macroPercent), fat: around(macros.fat, tolerance.macroPercent),
    carbs: around(macros.carbs, tolerance.macroPercent) };
}

export type CalcRuleError = "CALC_PROFILE_INVALID" | "CALC_STEPS_INVALID";

const isWhole = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** Проверка профиля перед записью. Пол, возраст и рост могут быть не введены (`null`) — это не ошибка и не ноль; остальные границы — защита от опечаток. */
export function validateCalcProfile(profile: CalcProfile): CalcProfile {
  const heightOk = profile.heightCm === null || (Number.isFinite(profile.heightCm) && profile.heightCm >= 50 && profile.heightCm <= 300
    && Math.abs(profile.heightCm * 10 - Math.round(profile.heightCm * 10)) < 1e-6);
  const ok = (profile.sex === null || profile.sex === "MALE" || profile.sex === "FEMALE") && (profile.age === null || isWhole(profile.age, 1, 120)) && heightOk
    && CALC_GOALS.includes(profile.goal) && CALC_ACTIVITIES.includes(profile.activity) && CALC_INTENSITIES.includes(profile.intensity)
    && isWhole(profile.workoutsPerWeek, 0, 21) && isWhole(profile.minutes, 1, 600) && isWhole(profile.stepKcal, 0, 1000);
  if (!ok) throw new Error("CALC_PROFILE_INVALID");
  return { ...profile };
}

export function assertSteps(steps: number): void {
  if (!isWhole(steps, 1, 100_000)) throw new Error("CALC_STEPS_INVALID");
}
