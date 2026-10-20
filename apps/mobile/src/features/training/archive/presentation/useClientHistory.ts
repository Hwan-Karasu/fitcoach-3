import { useEffect, useState } from "react";
import type { TrainingHistoryEntry } from "./trainingHistory.ts";

/** Источник хронологии для экранов: чтение и перечитывание при изменениях (`history.subscribe`); до первого чтения `entries = null`. */
export function useClientHistory(history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
  subscribe: (clientId: string, listener: () => void) => () => void }>, clientId: string):
  Readonly<{ entries: readonly TrainingHistoryEntry[] | null; failed: boolean }> {
  const [entries, setEntries] = useState<readonly TrainingHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    history.list(clientId).then((next) => { if (active) { setEntries(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, history, version]);
  useEffect(() => history.subscribe(clientId, () => setVersion((value) => value + 1)), [clientId, history]);
  return { entries, failed };
}
