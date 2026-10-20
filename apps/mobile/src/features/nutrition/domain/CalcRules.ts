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
  /** Масса для расчёта белка и жира: сухая масса, а без % жира — 80 % веса (как в 2.0); без веса — `null`. */
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
  const macroMassKg = lean !== null ? lean : positive(inputs.weightKg) ? Math.round(inputs.weightKg * 0.8 * 10) / 10 : null;
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
  const fat = Math.round(leanMassKg * 0.8);
  return { protein, fat, carbs: Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4)) };
}

/**
 * Пересчёт макронутриентов вокруг калорийного ориентира `calories` при ручном вводе тренера (формулы 2.0: applyManualMacros / calcCorrMacros). Введённое фиксируется как есть;
 * недостающее считается так, чтобы попасть в калории (1 г белка и углеводов = 4 ккал, жира = 9 ккал), остаток не меньше 0:
 * — введено два показателя: третий — остаток калорий; — введён один: белок и жир берут расчётные значения, а добирает последний из остальных (при вводе белка или жира — углеводы,
 *   при вводе углеводов — жир; в 2.0 здесь введённые углеводы затирались, это не переносится); — введено три: ровно как введены; — ничего: расчётные значения.
 * Нет калорий или расчётных значений, нужных для пересчёта, — недостающее `null`, а не выдуманное.
 */
export function rebalanceMacros(calories: number | null, defaults: MacroGrams, manual: MacroGrams): MacroGrams {
  const set = (value: number | null): value is number => value !== null;
  const rest = (value: number, kcalPerG: number) => Math.max(0, Math.round(value / kcalPerG));
  const { protein: mp, fat: mf, carbs: mc } = manual;
  const count = [mp, mf, mc].filter(set).length;
  if (count === 0) return defaults;
  if (count === 3) return { protein: mp, fat: mf, carbs: mc };
  if (count === 2) {
    if (!set(calories)) return { protein: mp, fat: mf, carbs: mc };
    if (!set(mc)) return { protein: mp, fat: mf, carbs: rest(calories - (mp as number) * 4 - (mf as number) * 9, 4) };
    if (!set(mf)) return { protein: mp, fat: rest(calories - (mp as number) * 4 - mc * 4, 9), carbs: mc };
    return { protein: rest(calories - (mf as number) * 9 - mc * 4, 4), fat: mf, carbs: mc };
  }
  // введён один показатель
  if (set(mp)) {
    const fat = defaults.fat;
    return { protein: mp, fat, carbs: set(calories) && fat !== null ? rest(calories - mp * 4 - fat * 9, 4) : null };
  }
  if (set(mf)) {
    const protein = defaults.protein;
    return { protein, fat: mf, carbs: set(calories) && protein !== null ? rest(calories - protein * 4 - mf * 9, 4) : null };
  }
  const protein = defaults.protein;
  return { protein, fat: set(calories) && protein !== null ? rest(calories - protein * 4 - (mc as number) * 4, 9) : null, carbs: mc };
}

/** Диапазон граммов макронутриента; равные границы — точное значение. */
export interface GramRange {
  readonly min: number;
  readonly max: number;
}
export type MacroRanges = Readonly<{ protein: GramRange | null; fat: GramRange | null; carbs: GramRange | null }>;

/**
 * Режим «Коридор»: те же правила пересчёта, что в `rebalanceMacros`, но введённые значения — диапазоны. Досчитанный показатель получает коридор, в котором калорийный ориентир достижим
 * при любых значениях введённых диапазонов (интервальная арифметика: `[(C − верх известных) / k; (C − низ известных) / k]`, не ниже 0, k = 4 для Б/У и 9 для Ж). Значения по расчёту
 * (белок и жир при одном введённом показателе) остаются числами. Точные числа дают тот же результат, что `rebalanceMacros`. Нет калорий или расчётных значений — `null`.
 */
export function rebalanceMacroRanges(calories: number | null, defaults: MacroGrams, manual: MacroRanges): MacroRanges {
  const point = (value: number | null): GramRange | null => value === null ? null : { min: value, max: value };
  const rest = (low: number, high: number, k: number): GramRange => {
    const min = Math.max(0, ((calories as number) - high) / k);
    const max = Math.max(0, ((calories as number) - low) / k);
    return { min: Math.round(min), max: Math.round(max) };
  };
  const kcal = (range: GramRange | null, k: number) => range === null ? null : { low: range.min * k, high: range.max * k };
  const { protein: mp, fat: mf, carbs: mc } = manual;
  const count = [mp, mf, mc].filter((value) => value !== null).length;
  if (count === 0) return { protein: point(defaults.protein), fat: point(defaults.fat), carbs: point(defaults.carbs) };
  if (count === 3) return manual;
  const known = (parts: readonly ({ low: number; high: number } | null)[]) => ({ low: parts.reduce((sum, part) => sum + (part?.low ?? 0), 0), high: parts.reduce((sum, part) => sum + (part?.high ?? 0), 0) });
  const noCalories = calories === null;
  if (count === 2) {
    if (mc === null) { const k = known([kcal(mp, 4), kcal(mf, 9)]); return { protein: mp, fat: mf, carbs: noCalories ? null : rest(k.low, k.high, 4) }; }
    if (mf === null) { const k = known([kcal(mp, 4), kcal(mc, 4)]); return { protein: mp, fat: noCalories ? null : rest(k.low, k.high, 9), carbs: mc }; }
    const k = known([kcal(mf, 9), kcal(mc, 4)]);
    return { protein: noCalories ? null : rest(k.low, k.high, 4), fat: mf, carbs: mc };
  }
  if (mp !== null) {
    if (defaults.fat === null) return { protein: mp, fat: null, carbs: null };
    const k = known([kcal(mp, 4), { low: defaults.fat * 9, high: defaults.fat * 9 }]);
    return { protein: mp, fat: point(defaults.fat), carbs: noCalories ? null : rest(k.low, k.high, 4) };
  }
  if (mf !== null) {
    if (defaults.protein === null) return { protein: null, fat: mf, carbs: null };
    const k = known([{ low: defaults.protein * 4, high: defaults.protein * 4 }, kcal(mf, 9)]);
    return { protein: point(defaults.protein), fat: mf, carbs: noCalories ? null : rest(k.low, k.high, 4) };
  }
  if (defaults.protein === null) return { protein: null, fat: null, carbs: mc };
  const k = known([{ low: defaults.protein * 4, high: defaults.protein * 4 }, kcal(mc, 4)]);
  return { protein: point(defaults.protein), fat: noCalories ? null : rest(k.low, k.high, 9), carbs: mc };
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

/** Подпись под суточным ориентиром. */
export function guideLabel(adjustment: number): string {
  return adjustment === 0 ? "Без поправки по весу" : `Поправка ${adjustment > 0 ? "+" : "−"}${Math.abs(adjustment)} ккал`;
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
