import { useEffect, useMemo, useState } from "react";
import { bodyweightLookup, type BodyOf, type BodyWeight, type BodyweightSource } from "./trainingStats.ts";

const EMPTY: readonly BodyWeight[] = [];

/**
 * Ряд массы тела клиента → поиск последнего достоверного замера на дату занятия (§48.86.36). Пока ряд грузится или
 * недоступен, подходы с собственным весом считаются неполными, а не нулевыми.
 */
export function useBodyOf(source: BodyweightSource, clientId: string): BodyOf {
  const [snapshot, setSnapshot] = useState<Readonly<{ source: BodyweightSource; clientId: string; points: readonly BodyWeight[] }> | null>(null);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = () => {
      const sequence = ++request;
      const accept = (points: readonly BodyWeight[]) => {
        if (active && sequence === request) setSnapshot({ source, clientId, points });
      };
      void Promise.resolve().then(() => source.list(clientId)).then(accept, () => accept(EMPTY));
    };
    load();
    const off = source.subscribe(clientId, load);
    return () => { active = false; off(); };
  }, [source, clientId]);
  const points = snapshot?.clientId === clientId && snapshot.source === source ? snapshot.points : EMPTY;
  return useMemo(() => bodyweightLookup(points), [points]);
}
