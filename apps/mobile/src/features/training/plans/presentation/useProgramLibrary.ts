import { useCallback, useEffect, useState } from "react";
import type { ClientProgramLibrary } from "../domain/ProgramModel.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";

/** Библиотека программ одного клиента; обновляется после коммита, затрагивающего этого клиента. */
export function useProgramLibrary(repository: TrainingPlansRepositoryPort, clientId: string) {
  const [library, setLibrary] = useState<ClientProgramLibrary | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    repository.getLibrary(clientId).then((next) => {
      if (!active) return;
      setLibrary(next);
      setFailed(false);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, repository, version]);

  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.clientIds.includes(clientId)) reload();
  }), [clientId, reload, repository]);

  // Снимок другого клиента не показываем, пока не загрузился свой (§5 Feature 09: план A не подменяется B).
  return { library: library?.clientId === clientId ? library : null, failed, reload };
}
