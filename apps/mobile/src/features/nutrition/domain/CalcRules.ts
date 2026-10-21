/**
 * Расчёт КБЖУ: справочная оценка суточного расхода и ориентиров БЖУ (UX v1.1: предложение целей убрано). Расчёт не создаёт и не меняет цели; неполные
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

/** Параметры расчёта, которые тренер вводит на экране «Расчёт». Пол, возраст и рост — из карточки клиента, вес и % жира — из Measurements: здесь их нет. */
export interface CalcProfile {
  readonly goal: CalcGoal;
  readonly activity: CalcActivity;
  readonly workoutsPerWeek: number;
  readonly minutes: number;
  readonly intensity: CalcIntensity;
  /** «Шаг цели», ккал: величина поправки для похудения и набора. */
  readonly stepKcal: number;
}

export interface CalcInputs {
  /** Из карточки клиента; `null` — не указано. */
  readonly sex: CalcSex | null;
  readonly age: number | null;
  readonly heightCm: number | null;
  readonly weightKg: number | null;
  readonly fatPercent: number | null;
  /** Средние шаги в день по дням с известными шагами; `null` — шагов нет. */
  readonly avgSteps: number | null;
}

export interface CalcResult {
  readonly leanMassKg: number | null;
  /** Масса для расчёта БЖУ: только известная сухая масса; без % жира — `null`. */
  readonly macroMassKg: number | null;
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
  const ree = calcRee(inputs.sex, inputs.age, inputs.heightCm, inputs.weightKg, lean);
  const fromSteps = positive(inputs.avgSteps) && positive(inputs.weightKg);
  const neat = calcNeat(inputs.avgSteps, inputs.weightKg, profile.activity);
  const eat = calcEat(inputs.weightKg, profile.workoutsPerWeek, profile.minutes, profile.intensity);
  const startTdee = ree !== null && eat !== null ? Math.round(ree + neat + eat) : null;
  const delta = goalDelta(profile.goal, profile.stepKcal);
  const macroMassKg = lean;
  return { leanMassKg: lean, macroMassKg, ree, neat, neatSource: fromSteps ? "STEPS" : "ACTIVITY", eat, startTdee, goalDelta: delta, target: startTdee === null ? null : startTdee + delta };
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
  // Десятые грамма: округление вверх удерживает жир не ниже 0,8 г/кг.
  const fat = Math.ceil((leanMassKg * 0.8 - 1e-9) * 10) / 10;
  const rest = (calories - protein * 4 - fat * 9) / 4;
  return { protein, fat, carbs: rest < 0 ? null : Math.round(rest * 10) / 10 };
}

/** Диапазон граммов; равные границы — точное значение. */
export interface GramRange { readonly min: number; readonly max: number }
export type MacroRanges = Readonly<{ protein: GramRange | null; fat: GramRange | null; carbs: GramRange | null }>;
export type MacroBalanceError = "MACRO_NEGATIVE_REMAINDER" | "MACRO_FAT_RANGE" | "MACRO_MASS_REQUIRED";

export function pointMacroRanges(macros: MacroGrams): MacroRanges {
  const point = (value: number | null): GramRange | null => value === null ? null : { min: value, max: value };
  return { protein: point(macros.protein), fat: point(macros.fat), carbs: point(macros.carbs) };
}

/** Автоматические коридоры: белок ±10 %, жир 0,8–1 г/кг сухой массы, углеводы — остаток по противоположным границам. */
export function automaticMacroRanges(calories: number | null, defaults: MacroGrams, leanMassKg: number | null): MacroRanges {
  if (!positive(calories) || !positive(leanMassKg) || defaults.protein === null) return { protein: null, fat: null, carbs: null };
  const tenth = (value: number) => Math.round(value * 10) / 10;
  const protein = { min: tenth(defaults.protein * 0.9), max: tenth(defaults.protein * 1.1) };
  const fat = { min: Math.ceil((leanMassKg * 0.8 - 1e-9) * 10) / 10, max: Math.floor((leanMassKg + 1e-9) * 10) / 10 };
  const low = (calories - protein.max * 4 - fat.max * 9) / 4;
  const high = (calories - protein.min * 4 - fat.min * 9) / 4;
  return { protein, fat, carbs: low < -1e-9 ? null : { min: tenth(Math.max(0, low)), max: tenth(high) } };
}

/**
 * Ручной ввод не меняется. Жир сохраняется до последнего: при одних углеводах пересчитывается белок.
 * Проверяем весь интервал до округления. Отрицательный остаток и жир вне 0,8–1 г/кг — конфликт.
 * Без необходимых исходных данных недостающие показатели остаются null.
 */
export function rebalanceMacroRanges(calories: number | null, defaults: MacroRanges, manual: MacroRanges, leanMassKg: number | null): MacroRanges {
  const count = Object.values(manual).filter((value) => value !== null).length;
  if (count === 0) return defaults;
  if (count === 3) return manual;
  const out = { ...manual };
  let missing: "protein" | "fat" | "carbs";
  if (count === 1) {
    if (manual.protein !== null) { out.fat = defaults.fat; missing = "carbs"; }
    else if (manual.fat !== null) { out.protein = defaults.protein; missing = "carbs"; }
    else { out.fat = defaults.fat; missing = "protein"; }
  } else missing = manual.protein === null ? "protein" : manual.fat === null ? "fat" : "carbs";
  if (calories === null || Object.entries(out).some(([key, value]) => key !== missing && value === null)) return out;
  if (missing === "fat" && !positive(leanMassKg)) throw new Error("MACRO_MASS_REQUIRED" satisfies MacroBalanceError);
  const factors = { protein: 4, fat: 9, carbs: 4 };
  let low = calories;
  let high = calories;
  for (const key of ["protein", "fat", "carbs"] as const) {
    if (key === missing) continue;
    low -= out[key]!.max * factors[key];
    high -= out[key]!.min * factors[key];
  }
  const min = low / factors[missing];
  const max = high / factors[missing];
  if (min < -1e-9) throw new Error("MACRO_NEGATIVE_REMAINDER" satisfies MacroBalanceError);
  if (missing === "fat" && (min < leanMassKg! * 0.8 - 1e-9 || max > leanMassKg! + 1e-9)) throw new Error("MACRO_FAT_RANGE" satisfies MacroBalanceError);
  const roundedMin = Math.round(Math.max(0, min) * 10) / 10;
  const roundedMax = Math.round(max * 10) / 10;
  const fatMin = leanMassKg === null ? 0 : Math.ceil((leanMassKg * 0.8 - 1e-9) * 10) / 10;
  const fatMax = leanMassKg === null ? 0 : Math.floor((leanMassKg + 1e-9) * 10) / 10;
  out[missing] = missing === "fat"
    ? { min: Math.min(fatMax, Math.max(roundedMin, fatMin)), max: Math.min(fatMax, Math.max(roundedMax, fatMin)) }
    : { min: roundedMin, max: roundedMax };
  return out;
}

/**
 * Динамика веса (формулы 2.0 `getWeightTrendKg`): не менее четырёх взвешиваний, по порядку дат; среднее второй половины минус среднее первой, с точностью 0,01 кг.
 * Меньше четырёх — `null` (нет динамики, а не «0»).
 */
export function weightTrendKg(weights: readonly number[]): number | null {
  if (weights.length < 4) return null;
  const middle = Math.floor(weights.length / 2);
  const average = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round((average(weights.slice(middle)) - average(weights.slice(0, middle))) * 100) / 100;
}

/**
 * Поправка суточного ориентира по динамике веса, ккал (формулы 2.0 `calcTrendAdjustment`, без «рекомпозиции» — её в 3.0 нет):
 * похудение — вес не снижается (Δ ≥ −0,15 кг) → −120, падает слишком быстро (≤ −1 %) → +120; набор — не растёт (Δ ≤ 0,05) → +120, растёт слишком быстро (≥ 0,35 %) → −100;
 * поддержание — |Δ| ≥ 0,35 кг: рост → −100, снижение → +100. Нет динамики — 0.
 */
export function trendAdjustment(goal: CalcGoal, deltaKg: number | null, referenceWeightKg: number | null): number {
  if (deltaKg === null) return 0;
  const percent = referenceWeightKg !== null && referenceWeightKg > 0 ? (deltaKg / referenceWeightKg) * 100 : null;
  if (goal === "LOSS") return deltaKg >= -0.15 ? -120 : percent !== null && percent <= -1 ? 120 : 0;
  if (goal === "GAIN") return deltaKg <= 0.05 ? 120 : percent !== null && percent >= 0.35 ? -100 : 0;
  return Math.abs(deltaKg) >= 0.35 ? (deltaKg > 0 ? -100 : 100) : 0;
}

export type CalcRuleError = "CALC_PROFILE_INVALID" | "CALC_STEPS_INVALID";

const isWhole = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** Проверка профиля расчёта перед записью: границы — защита от опечаток. */
export function validateCalcProfile(profile: CalcProfile): CalcProfile {
  const ok = CALC_GOALS.includes(profile.goal) && CALC_ACTIVITIES.includes(profile.activity) && CALC_INTENSITIES.includes(profile.intensity)
    && isWhole(profile.workoutsPerWeek, 0, 21) && isWhole(profile.minutes, 1, 600) && isWhole(profile.stepKcal, 0, 1000);
  if (!ok) throw new Error("CALC_PROFILE_INVALID");
  return { ...profile };
}

export function assertSteps(steps: number): void {
  if (!isWhole(steps, 1, 100_000)) throw new Error("CALC_STEPS_INVALID");
}
