import { useEffect, useRef, useState } from "react";
import type { TrainingProgram } from "../domain/ProgramModel.ts";
import type { PeriodizedPlan } from "../domain/PeriodizedModel.ts";
import type { GroupCopy } from "../domain/Placement.ts";
import type { SimplePlan } from "../domain/SimplePlanModel.ts";
import type { SimpleWeek } from "../domain/SimpleWorkoutEdit.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";

/** Что показано на экране программы: чьи данные (`shown`), план и группа выбранного мезоцикла. */
export function useProgramData({ clientId, programId, repository, requestedMesocycle, requestedWeek, onRequestedWeek, onMessage, focused = true }: Readonly<{
  clientId: string;
  programId: string;
  repository: TrainingPlansRepositoryPort;
  requestedMesocycle?: string;
  requestedWeek?: number;
  /** Неделя запрошенного места уже применена данными загрузки (ключ — мезоцикл или `simple`). */
  onRequestedWeek: (key: string, week: number) => void;
  onMessage: (text: string) => void;
  focused?: boolean;
}>) {
  const [program, setProgram] = useState<TrainingProgram | null | undefined>(undefined);
  const [plan, setPlan] = useState<SimplePlan | null>(null);
  const [simpleWeeks, setSimpleWeeks] = useState<readonly SimpleWeek[]>([]);
  const [periodized, setPeriodized] = useState<PeriodizedPlan | null>(null);
  /** Чьи данные сейчас на экране (`клиент:программа`): при переключении участника до загрузки они прежние — тогда экран приглушён. */
  const [shown, setShown] = useState<Readonly<{ clientId: string; programId: string }> | null>(null);
  const [version, setVersion] = useState(0);
  const [groupVersion, setGroupVersion] = useState(0);
  /** `null` — группа выбранного мезоцикла ещё не прочитана (переключатель участников её не показывает и не прячет). */
  const [group, setGroup] = useState<readonly GroupCopy[] | null>(null);
  const callbacks = useRef({ onRequestedWeek, onMessage });
  callbacks.current = { onRequestedWeek, onMessage };
  const cycleKey = periodized?.selectedMesocycleId ?? periodized?.mesocycles[0]?.id ?? "simple";
  const loadedStamp = useRef("");
  const loadedRepository = useRef<TrainingPlansRepositoryPort | null>(null);

  useEffect(() => {
    const stamp = JSON.stringify([clientId, programId, version]);
    if (!focused || (loadedRepository.current === repository && loadedStamp.current === stamp)) return undefined;
    let active = true;
    repository.getProgram(clientId, programId).then(async (next) => {
      if (!active) return;
      if (next !== null) void repository.selectProgram(clientId, programId).catch(() => undefined);
      // Всё читается до отрисовки и ставится одним обновлением: экран не показывает смесь данных двух участников.
      const [simple, weeks, loaded] = await Promise.all([
        next?.kind === "SIMPLE" ? repository.getSimplePlan(clientId, programId) : null,
        next?.kind === "SIMPLE" ? repository.getSimpleWeeks(clientId, programId) : [],
        next?.kind === "PERIODIZED" ? repository.getPeriodizedPlan(clientId, programId) : null,
      ]);
      if (!active) return;
      setProgram(next);
      setPlan(simple?.draft.plan ?? null);
      setSimpleWeeks(weeks);
      // Мезоцикл и неделя запрошенного участника — теми же данными: иначе до загрузки экран показывает чужой мезоцикл.
      const wanted = requestedMesocycle !== undefined && loaded?.mesocycles.some((item) => item.id === requestedMesocycle) === true
        && loaded.selectedMesocycleId !== requestedMesocycle ? requestedMesocycle : null;
      if (wanted !== null) void repository.selectMesocycle(clientId, programId, wanted).catch(() => callbacks.current.onMessage("Не удалось выбрать мезоцикл."));
      setPeriodized(loaded !== null && wanted !== null ? { ...loaded, selectedMesocycleId: wanted } : loaded);
      if (requestedWeek !== undefined && next !== null) {
        const key = next.kind === "SIMPLE" ? "simple" : requestedMesocycle ?? loaded?.selectedMesocycleId ?? loaded?.mesocycles[0]?.id;
        if (key != null) callbacks.current.onRequestedWeek(key, requestedWeek);
      }
      setShown({ clientId, programId });
      loadedStamp.current = stamp;
      loadedRepository.current = repository;
    }).catch(() => {
      if (active) { setProgram((current) => current === undefined ? null : current); callbacks.current.onMessage("Не удалось загрузить структуру программы."); }
    });
    return () => { active = false; };
  }, [clientId, focused, programId, repository, version]);

  // UI-OWN-044: участники — группа выбранного мезоцикла (копии в любых программах), а не участники программы. Одно чтение на экран:
  // его результат получают и «N участников» в карточке, и полоса участников.
  useEffect(() => {
    if (!focused || shown === null || shown.clientId !== clientId || shown.programId !== programId) return undefined;
    if (cycleKey === "simple") { setGroup([]); return undefined; }
    let active = true;
    // Идентичность — показанных данных: мезоцикл `cycleKey` принадлежит им, а не новому участнику, пока тот не загружен.
    repository.getMesocycleGroup(shown?.clientId ?? clientId, shown?.programId ?? programId, { mesocycleId: cycleKey })
      .then((copies) => { if (active) setGroup(copies); }).catch(() => undefined);
    return () => { active = false; };
  }, [clientId, cycleKey, focused, programId, repository, shown, version, groupVersion]);

  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.selectionOnly !== true) setGroupVersion((value) => value + 1);
    if (change.selectionOnly !== true && change.orderOnly !== true && change.clientIds.includes(clientId)) setVersion((value) => value + 1);
  }), [clientId, repository]);

  return { program, setProgram, plan, simpleWeeks, periodized, setPeriodized, shown, group, cycleKey,
    refresh: () => setVersion((value) => value + 1) };
}
