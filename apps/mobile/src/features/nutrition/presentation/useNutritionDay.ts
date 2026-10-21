import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DaySummary, DiaryEntry } from "../domain/DiaryModel.ts";
import { summarizeDay } from "../domain/DiaryRules.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import type { ResolvedTarget, TargetException, TargetVersion } from "../domain/TargetModel.ts";
import { resolveTarget } from "../domain/TargetRules.ts";
import { shiftDate } from "./nutritionFormat.ts";

export interface NutritionDayData {
  readonly entries: readonly DiaryEntry[];
  readonly summary: DaySummary;
  readonly target: ResolvedTarget;
  /** Версии целей клиента — для ориентира дня (расчёт главной + ручная корректировка на дату). */
  readonly versions: readonly TargetVersion[];
  readonly waterMl: number | null;
}

/** Сколько дней в обе стороны от выбранного читается заранее: соседний день открывается сразу, без ожидания. */
const PREFETCH_DAYS = 3;
const CACHE_LIMIT = 60;

interface DayRows { readonly entries: readonly DiaryEntry[]; readonly waterMl: number | null; readonly generation: number }

/**
 * День питания клиента: записи, вода и цель на дату. Дни читаются окном ±3 дня от выбранного и кэшируются по дате: переход на соседний день берёт готовые данные
 * без ожидания. Пока выбранного дня в кэше нет, показывается прежний (`stale`), экран не пересоздаётся. Кэш обновляется (не сбрасывается) при фиксации изменений
 * этого клиента: старые данные остаются на экране, пока читаются новые. Подписки отдаются в cleanup.
 */
export function useNutritionDay(clientId: string, localDate: string, diary: NutritionDiaryPort,
  targets: NutritionTargetsPort): Readonly<{ data: NutritionDayData | null; stale: boolean; failed: boolean; reload: () => void }> {
  const cache = useRef(new Map<string, DayRows>());
  const lastShown = useRef<Readonly<{ localDate: string; rows: DayRows }> | null>(null);
  const [, bump] = useReducer((value: number) => value + 1, 0);
  const [goals, setGoals] = useState<Readonly<{ versions: readonly TargetVersion[]; exceptions: readonly TargetException[] }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [goalsTick, setGoalsTick] = useState(0);
  const reload = useCallback(() => { setFailed(false); setTick((value) => value + 1); setGoalsTick((value) => value + 1); }, []);

  useEffect(() => {
    let active = true;
    const dates = Array.from({ length: PREFETCH_DAYS * 2 + 1 }, (_, index) => shiftDate(localDate, index - PREFETCH_DAYS));
    if (dates.every((date) => cache.current.get(date)?.generation === tick)) return;
    const from = dates[0] as string;
    const to = dates[dates.length - 1] as string;
    void Promise.all([diary.listEntries(clientId, from, to), diary.listWater(clientId, from, to)]).then(([entries, water]) => {
      if (!active) return;
      for (const date of dates) {
        cache.current.set(date, { entries: entries.filter((entry) => entry.localDate === date), waterMl: water.find((day) => day.localDate === date)?.ml ?? null, generation: tick });
      }
      if (cache.current.size > CACHE_LIMIT) {
        const keep = new Set(dates);
        for (const date of [...cache.current.keys()]) if (!keep.has(date) && cache.current.size > CACHE_LIMIT) cache.current.delete(date);
      }
      setFailed(false);
      bump();
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, localDate, diary, tick]);

  useEffect(() => {
    let active = true;
    void Promise.all([targets.listVersions(clientId), targets.listExceptions(clientId)]).then(([versions, exceptions]) => {
      if (active) { setGoals({ versions, exceptions }); setFailed(false); }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, targets, goalsTick]);

  useEffect(() => {
    const offDiary = diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); });
    const offTargets = targets.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setGoalsTick((value) => value + 1); });
    return () => { offDiary(); offTargets(); };
  }, [clientId, diary, targets]);

  const current = cache.current.get(localDate);
  if (current !== undefined) lastShown.current = { localDate, rows: current };
  const shownRows = current ?? lastShown.current?.rows ?? null;
  const shownDate = current !== undefined ? localDate : (lastShown.current?.localDate ?? localDate);
  const stale = shownRows !== null && current === undefined;
  const data = useMemo<NutritionDayData | null>(() => {
    if (shownRows === null || goals === null) return null;
    return { entries: shownRows.entries, waterMl: shownRows.waterMl, summary: summarizeDay(shownDate, shownRows.entries),
      target: resolveTarget(goals.versions, goals.exceptions, shownDate), versions: goals.versions };
  }, [shownRows, shownDate, goals]);
  return { data, stale, failed, reload };
}
