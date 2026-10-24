import { validateCalcProfile, type CalcProfile } from "../../apps/mobile/src/features/nutrition/domain/CalcRules.ts";
import type { NutritionRaw as Raw } from "./LegacyNutritionSourceReader.ts";
import { nutritionFail as fail, nutritionJson, nutritionObject as object } from "./LegacyNutritionValues.ts";

const goals = new Map<unknown, CalcProfile["goal"]>([["Похудение", "LOSS"], ["Поддержание", "MAINTENANCE"], ["Набор", "GAIN"]]);
const activities = new Map<unknown, CalcProfile["activity"]>([["Сидячий", "SEDENTARY"], ["Умеренный", "MODERATE"], ["Активный", "ACTIVE"], ["Очень активный", "VERY_ACTIVE"]]);
const intensities = new Map<unknown, CalcProfile["intensity"]>([["Легкая", "LIGHT"], ["Средняя", "MEDIUM"], ["Тяжелая", "HEAVY"]]);
const parameters = ["goal", "activity", "workouts", "workoutDuration", "workoutIntensity", "deficit"] as const;
const bodyFields = ["gender", "age", "height", "weight", "fatPercent"] as const;

/** Current saved parameters only. A blank/missing numeric value is not zero;
 * repository UI defaults and profile seeding do not prove a saved user value. */
export function legacyCalcProfile(profile: Raw): CalcProfile {
  const whole = (key: string) => {
    const raw = profile[key];
    if (typeof raw !== "string" || !/^\d+(?:[.,]0+)?$/u.test(raw.trim())) return fail("CALC_PARAMETER_UNREPRESENTABLE");
    const value = Number(raw.trim().replace(",", "."));
    return Number.isSafeInteger(value) ? value : fail("CALC_PARAMETER_UNREPRESENTABLE");
  };
  const goal = goals.get(profile.goal), activity = activities.get(profile.activity), intensity = intensities.get(profile.workoutIntensity);
  if (!goal || !activity || !intensity) return fail("CALC_ENUM_UNSUPPORTED");
  return validateCalcProfile({ goal, activity, intensity, workoutsPerWeek: whole("workouts"), minutes: whole("workoutDuration"), stepKcal: whole("deficit") });
}

/** These undated input snapshots must not overwrite Client/Measurements or become
 * an effective-from target schedule. Their original tokens remain in source_json. */
export function legacyCalcInputSnapshot(profile: Raw) {
  const inputs = Object.fromEntries(bodyFields.filter((key) => Object.hasOwn(profile, key)).map((key) => [key, profile[key]]));
  const unknownFields = Object.keys(profile).filter((key) => ![...parameters, ...bodyFields].includes(key as typeof parameters[number])).sort();
  return { inputs, unknownFields, hasBodyInputs: Object.values(inputs).some((value) => value != null && value !== ""),
    datePrecision: "UNKNOWN", targetMeasurementIds: [], clientProfileOverwritten: false };
}

export function legacyManualMacroSnapshot(raw: unknown) {
  const manual = object(nutritionJson(raw));
  // v2 engine macroMath rounds manual inputs when deriving an estimate, not when
  // storing the JSON. Preserve the input; do not silently round it into a target.
  const keys = ["protein", "fat", "carbs"] as const;
  const values = Object.fromEntries(keys.filter((key) => Object.hasOwn(manual, key)).map((key) => [key, manual[key]]));
  return { values, unknownFields: Object.keys(manual).filter((key) => !keys.includes(key as typeof keys[number])).sort(),
    hasValues: Object.values(values).some((value) => value != null && value !== ""),
    effectiveFrom: null, targetVersionId: null, semantics: "UNDATED_CALCULATOR_INPUT_NOT_TARGET_SCHEDULE" };
}
