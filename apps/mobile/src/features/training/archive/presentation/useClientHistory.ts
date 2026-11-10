import { useCallback, useEffect, useState } from "react";
import { useFocusGatedVersion } from "../../../../shared/ui/components/useFocusGatedVersion.ts";
import type { TrainingHistoryEntry } from "./trainingHistory.ts";

/**
 * Источник хронологии для экранов: чтение и перечитывание при изменениях (`history.subscribe`); до первого чтения `entries = null`.
 * Скрытый экран не перечитывает историю на каждую запись дневника — один раз при возврате (`useFocusGatedVersion`).
 * `version` — номер изменения для зависимых чтений экрана.
 */
export function useClientHistory(history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
  subscribe: (clientId: string, listener: () => void) => () => void }>, clientId: string):
  Readonly<{ entries: readonly TrainingHistoryEntry[] | null; failed: boolean; version: number }> {
  const [loaded, setLoaded] = useState<Readonly<{ clientId: string; source: typeof history; entries: readonly TrainingHistoryEntry[] }> | null>(null);
  const [failure, setFailure] = useState<Readonly<{ clientId: string; source: typeof history }> | null>(null);
  const subscribe = useCallback((listener: () => void) => history.subscribe(clientId, listener), [clientId, history]);
  const version = useFocusGatedVersion(subscribe);
  useEffect(() => {
    let active = true;
    history.list(clientId).then((next) => { if (active) { setLoaded({ clientId, source: history, entries: next }); setFailure(null); } })
      .catch(() => { if (active) setFailure({ clientId, source: history }); });
    return () => { active = false; };
  }, [clientId, history, version]);
  return { entries: loaded?.clientId === clientId && loaded.source === history ? loaded.entries : null,
    failed: failure?.clientId === clientId && failure.source === history, version };
}
