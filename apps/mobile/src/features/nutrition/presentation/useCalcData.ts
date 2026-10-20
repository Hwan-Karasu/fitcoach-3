import { useCallback, useEffect, useState } from "react";
import { latestPoint, localDateOf, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import type { CalcProfile } from "../domain/CalcRules.ts";
import type { NutritionCalcPort, StoredCalcProfile } from "../domain/NutritionCalcPort.ts";
import { shiftDate } from "./nutritionFormat.ts";

/** Шаги для NEAT усредняются за последние 30 дней — только по дням с записью (неизвестно ≠ 0). */
const STEPS_WINDOW_DAYS = 30;

/** Профиль по умолчанию: «не введено» остаётся пустым, а не угаданным (§49.10 п. 4); тренировок нет, пока тренер их не укажет. */
export const DEFAULT_CALC_PROFILE: CalcProfile = { goal: "MAINTENANCE", activity: "MODERATE", workoutsPerWeek: 0, minutes: 60, intensity: "MEDIUM", stepKcal: 100 };

export interface CalcLoaded {
  readonly stored: StoredCalcProfile | null;
  /** Последнее значение веса / % жира из Measurements (единственная запись дня или основная); неоднозначное — `null`. */
  readonly weight: number | null;
  readonly fat: number | null;
  readonly steps: number | null;
}

/**
 * Исходные данные расчёта клиента: профиль, последние вес и % жира (Measurements), средние шаги. Обновляется при фиксации изменений этого клиента
 * в расчёте или замерах; подписки снимаются в cleanup. `reload` — принудительное перечитывание после ошибки записи.
 */
export function useCalcData(clientId: string, calc: NutritionCalcPort, measurements: MeasurementRepositoryPort): Readonly<{ loaded: CalcLoaded | null; failed: boolean; reload: () => void }> {
  const [loaded, setLoaded] = useState<Readonly<{ key: string; value: CalcLoaded }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    const today = localDateOf(new Date());
    void Promise.all([calc.getProfile(clientId), measurements.listForClient(clientId), calc.averageSteps(clientId, shiftDate(today, -STEPS_WINDOW_DAYS + 1), today)]).then(([stored, data, steps]) => {
      if (!active) return;
      const point = (type: "WEIGHT" | "BODY_FAT") => { const latest = latestPoint(data.measurements, data.primaries, type); return latest !== null && latest.kind === "VALUE" ? latest.measurement.valueX10 / 10 : null; };
      setLoaded({ key: clientId, value: { stored, weight: point("WEIGHT"), fat: point("BODY_FAT"), steps } });
      setFailed(false);
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [calc, measurements, clientId, tick]);
  useEffect(() => {
    const offCalc = calc.subscribeCommittedChanges((change) => { if (change.clientId === clientId) reload(); });
    const offMeasurements = measurements.subscribeCommittedChanges((change) => { if (change.clientId === clientId) reload(); });
    return () => { offCalc(); offMeasurements(); };
  }, [calc, measurements, clientId, reload]);

  // Данные прежнего клиента не показываются, пока не загружены данные нового.
  return { loaded: loaded !== null && loaded.key === clientId ? loaded.value : null, failed, reload };
}
