import { useEffect, useState } from "react";
import { dailyPoints, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import { SLEEP_GOAL_HOURS, MEALS_GOAL, STEPS_GOAL } from "../domain/ActivityGoals.ts";
import { datesIn, type DateSpan } from "../domain/MetricPeriods.ts";
import { expenditureByDay, type DatedValue, type MetricId } from "../domain/MetricSeries.ts";
import { mealCount, summarizeDay } from "../domain/DiaryRules.ts";
import type { EatenEntry } from "../domain/DiaryModel.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { DEFAULT_CALC_PROFILE } from "./useCalcData.ts";

export interface MetricSeriesData {
  /** Значение по дням; нет данных за день — нет ключа. */
  readonly values: ReadonlyMap<string, number>;
  /** Цель для пунктирной линии; `null` — цели нет (расход без расчёта). */
  readonly goal: number | null;
}

const datedValues = (measurements: Awaited<ReturnType<MeasurementRepositoryPort["listForClient"]>>, type: "WEIGHT" | "BODY_FAT"): readonly DatedValue[] =>
  dailyPoints(measurements.measurements, measurements.primaries, type).flatMap((point) => point.kind === "VALUE"
    ? [{ date: point.localDate, value: point.measurement.valueX10 / 10 }] : []);

function groupMeals(entries: readonly EatenEntry[], span: DateSpan): ReadonlyMap<string, number> {
  const byDate = new Map<string, EatenEntry[]>();
  for (const entry of entries) byDate.set(entry.localDate, [...(byDate.get(entry.localDate) ?? []), entry]);
  const result = new Map<string, number>();
  for (const date of datesIn(span)) {
    const dayEntries = byDate.get(date);
    if (dayEntries === undefined) continue;
    const meals = mealCount(summarizeDay(date, dayEntries));
    if (meals > 0) result.set(date, meals);
  }
  return result;
}

/**
 * Ряд показателя за интервал для экрана показателя (UIX-08): шаги и приёмы — из записей дней, расход — расчёт по шагам дня,
 * сон — пока без данных (придёт из Health Connect, UIX-16). Обновляется при изменении данных клиента; подписки снимаются в cleanup.
 * Пока читается новый интервал, прежние данные не выдаются за новые: возвращается `null`.
 */
export function useMetricSeries(metric: MetricId, span: DateSpan, clientId: string, body: CalcClientBody, tdee: number | null,
  ports: Readonly<{ diary: NutritionDiaryPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort }>): Readonly<{ data: MetricSeriesData | null; failed: boolean }> {
  const { diary, calc, measurements } = ports;
  const key = `${metric}|${clientId}|${span.from}|${span.to}`;
  const [state, setState] = useState<Readonly<{ key: string; values: ReadonlyMap<string, number> }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const { sex, age, heightCm } = body;

  useEffect(() => {
    let active = true;
    setFailed(false);
    const load = async (): Promise<ReadonlyMap<string, number>> => {
      if (metric === "sleep") return new Map();
      if (metric === "steps") return new Map((await calc.listSteps(clientId, span.from, span.to)).map((day) => [day.localDate, day.steps]));
      if (metric === "meals") return groupMeals(await diary.listEatenEntries(clientId, span.from, span.to), span);
      const [steps, stored, journal] = await Promise.all([calc.listSteps(clientId, span.from, span.to), calc.getProfile(clientId), measurements.listForClient(clientId)]);
      return expenditureByDay({ profile: stored?.profile ?? DEFAULT_CALC_PROFILE, body: { sex, age, heightCm }, dates: datesIn(span),
        steps: new Map(steps.map((day) => [day.localDate, day.steps])), weights: datedValues(journal, "WEIGHT"), fats: datedValues(journal, "BODY_FAT") });
    };
    void load().then((values) => { if (active) { setState({ key, values }); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [metric, clientId, span.from, span.to, key, diary, calc, measurements, sex, age, heightCm, tick]);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offCalc = calc.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    const offDiary = diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId && change.scope !== "WATER") refresh(); });
    const offBody = measurements.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    return () => { offCalc(); offDiary(); offBody(); };
  }, [clientId, calc, diary, measurements]);

  const goal = metric === "steps" ? STEPS_GOAL : metric === "meals" ? MEALS_GOAL : metric === "sleep" ? SLEEP_GOAL_HOURS : tdee;
  return { data: state !== null && state.key === key ? { values: state.values, goal } : null, failed };
}
