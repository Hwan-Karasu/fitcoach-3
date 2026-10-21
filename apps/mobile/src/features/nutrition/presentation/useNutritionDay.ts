import { useCallback, useEffect, useMemo, useState } from "react";
import type { DaySummary, DiaryEntry } from "../domain/DiaryModel.ts";
import { summarizeDay } from "../domain/DiaryRules.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import type { ResolvedTarget, TargetException, TargetVersion } from "../domain/TargetModel.ts";
import { resolveTarget } from "../domain/TargetRules.ts";

export interface NutritionDayData {
  readonly entries: readonly DiaryEntry[];
  readonly summary: DaySummary;
  readonly target: ResolvedTarget;
  readonly waterMl: number | null;
}

/**
 * День питания клиента: записи, вода и цель на дату. Показывает последнюю загруженную версию, пока идёт обновление; обновляется только
 * при фиксации изменений этого клиента (дневник — этой даты). Подписки отдаются в cleanup.
 */
export function useNutritionDay(clientId: string, localDate: string, diary: NutritionDiaryPort,
  targets: NutritionTargetsPort): Readonly<{ data: NutritionDayData | null; failed: boolean; reload: () => void }> {
  const [loaded, setLoaded] = useState<Readonly<{ key: string; entries: readonly DiaryEntry[]; waterMl: number | null;
    versions: readonly TargetVersion[]; exceptions: readonly TargetException[] }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => { setFailed(false); setTick((value) => value + 1); }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([diary.listEntries(clientId, localDate, localDate), diary.listWater(clientId, localDate, localDate),
      targets.listVersions(clientId), targets.listExceptions(clientId)]).then(([entries, water, versions, exceptions]) => {
      if (active) { setLoaded({ key: `${clientId}|${localDate}`, entries, waterMl: water[0]?.ml ?? null, versions, exceptions }); setFailed(false); }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, localDate, diary, targets, tick]);

  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offDiary = diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId && change.localDate === localDate) refresh(); });
    const offTargets = targets.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    return () => { offDiary(); offTargets(); };
  }, [clientId, localDate, diary, targets]);

  const data = useMemo<NutritionDayData | null>(() => {
    if (loaded === null || loaded.key !== `${clientId}|${localDate}`) return null;
    return { entries: loaded.entries, waterMl: loaded.waterMl, summary: summarizeDay(localDate, loaded.entries),
      target: resolveTarget(loaded.versions, loaded.exceptions, localDate) };
  }, [loaded, clientId, localDate]);
  return { data, failed, reload };
}
