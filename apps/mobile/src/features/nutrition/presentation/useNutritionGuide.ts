import { useMemo } from "react";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import { calcMacros, deriveCalc, trendAdjustment, weightTrendKg, type MacroGrams } from "../domain/CalcRules.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { DEFAULT_CALC_PROFILE, useCalcData, type CalcLoaded } from "./useCalcData.ts";

export interface NutritionGuide {
  readonly loaded: CalcLoaded | null;
  /** Суточный ориентир, ккал: расчёт (с целью) + поправка по динамике веса за 7 дней; `null` — расчёта нет. */
  readonly guide: number | null;
  /** Расчётные Б/Ж/У под ориентир; `null` — не определены. */
  readonly defaults: MacroGrams | null;
  readonly leanMassKg: number | null;
}

/** Расчётный суточный ориентир клиента — один источник для главной клиента и дневника питания. Подписки данных расчёта снимаются в `useCalcData`. */
export function useNutritionGuide(clientId: string, body: CalcClientBody, calc: NutritionCalcPort, measurements: MeasurementRepositoryPort): NutritionGuide {
  const { loaded } = useCalcData(clientId, calc, measurements);
  const profile = loaded?.stored?.profile ?? DEFAULT_CALC_PROFILE;
  const result = useMemo(() => loaded === null ? null : deriveCalc(profile, { sex: body.sex, age: body.age, heightCm: body.heightCm, weightKg: loaded.weight, fatPercent: loaded.fat, avgSteps: loaded.steps }), [loaded, profile, body]);
  const adjustment = loaded === null ? 0 : trendAdjustment(profile.goal, weightTrendKg(loaded.weights), loaded.weight);
  // Ориентир не бывает неположительным: поправка не должна обнулять расчёт.
  const guide = result === null || result.target === null || result.target + adjustment <= 0 ? null : result.target + adjustment;
  const defaults = useMemo(() => result === null ? null : calcMacros(result.macroMassKg, guide, profile.goal), [result, guide, profile.goal]);
  return { loaded, guide, defaults, leanMassKg: result?.leanMassKg ?? null };
}
