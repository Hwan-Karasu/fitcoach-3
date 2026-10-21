import { useCallback, useEffect, useState } from "react";
import type { ExerciseInfo, ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";

/**
 * Справочник упражнений для экранов планов; обновляется при изменении каталога. Отказ чтения не превращается в вечную загрузку:
 * `failed` позволяет показать ошибку, `retry` — прочитать заново.
 */
export function useExerciseLookupState(port: ExerciseLookupPort): Readonly<{ lookup: ReadonlyMap<string, ExerciseInfo> | null;
  failed: boolean; retry: () => void }> {
  const [lookup, setLookup] = useState<ReadonlyMap<string, ExerciseInfo> | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    port.lookup().then((next) => { if (active) { setLookup(next); setFailed(false); } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [port, version]);
  useEffect(() => port.subscribe(() => setVersion((value) => value + 1)), [port]);
  const retry = useCallback(() => { setFailed(false); setVersion((value) => value + 1); }, []);
  return { lookup, failed, retry };
}

export function useExerciseLookup(port: ExerciseLookupPort): ReadonlyMap<string, ExerciseInfo> | null {
  return useExerciseLookupState(port).lookup;
}
