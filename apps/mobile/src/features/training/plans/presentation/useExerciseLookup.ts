import { useEffect, useState } from "react";
import type { ExerciseInfo, ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";

/** Справочник упражнений для экранов планов; обновляется при изменении каталога. */
export function useExerciseLookup(port: ExerciseLookupPort): ReadonlyMap<string, ExerciseInfo> | null {
  const [lookup, setLookup] = useState<ReadonlyMap<string, ExerciseInfo> | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    port.lookup().then((next) => { if (active) setLookup(next); }).catch(() => undefined);
    return () => { active = false; };
  }, [port, version]);
  useEffect(() => port.subscribe(() => setVersion((value) => value + 1)), [port]);
  return lookup;
}
