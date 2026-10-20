import { useEffect, useMemo, useState } from "react";
import { bodyweightLookup, type BodyOf, type BodyWeight, type BodyweightSource } from "./trainingStats.ts";

/**
 * Ряд массы тела клиента → поиск последнего достоверного замера на дату занятия (§48.86.36). Пока ряд грузится или
 * недоступен, подходы с собственным весом считаются неполными, а не нулевыми.
 */
export function useBodyOf(source: BodyweightSource, clientId: string): BodyOf {
  const [points, setPoints] = useState<readonly BodyWeight[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => { source.list(clientId).then((next) => { if (active) setPoints(next); }).catch(() => { if (active) setPoints([]); }); };
    load();
    const off = source.subscribe(clientId, load);
    return () => { active = false; off(); };
  }, [source, clientId]);
  return useMemo(() => bodyweightLookup(points), [points]);
}
