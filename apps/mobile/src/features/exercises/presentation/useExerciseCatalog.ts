import { useCallback, useEffect, useState } from "react";
import type { ExerciseCatalogPort } from "../domain/ExerciseCatalogPort.ts";
import { compareEntries, type CatalogEntry } from "../domain/ExerciseRules.ts";

/** Весь каталог с личным слоем; перечитывается после любого коммита каталога. */
export function useExerciseCatalog(repository: ExerciseCatalogPort) {
  const [entries, setEntries] = useState<readonly CatalogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    repository.list().then((next) => {
      if (!active) return;
      setEntries([...next].sort(compareEntries));
      setFailed(false);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [repository, version]);

  useEffect(() => repository.subscribeCommittedChanges(reload), [reload, repository]);

  return { entries, failed, reload };
}
