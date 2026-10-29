import { useCallback, useEffect, useState } from "react";
import { useFocusGatedVersion } from "../../../../shared/ui/components/public.ts";
import type { TrainingHistoryEntry } from "./trainingHistory.ts";

/**
 * Источник хронологии для экранов: чтение и перечитывание при изменениях (`history.subscribe`); до первого чтения `entries = null`.
 * Скрытый экран не перечитывает историю на каждую запись дневника — один раз при возврате (`useFocusGatedVersion`).
 * `version` — номер изменения для зависимых чтений экрана.
 */
export function useClientHistory(history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
  subscribe: (clientId: string, listener: () => void) => () => void }>, clientId: string):
  Readonly<{ entries: readonly TrainingHistoryEntry[] | null; failed: boolean; version: number }> {
  const [entries, setEntries] = useState<readonly TrainingHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const subscribe = useCallback((listener: () => void) => history.subscribe(clientId, listener), [clientId, history]);
  const version = useFocusGatedVersion(subscribe);
  useEffect(() => {
    let active = true;
    history.list(clientId).then((next) => { if (active) { setEntries(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, history, version]);
  return { entries, failed, version };
}
