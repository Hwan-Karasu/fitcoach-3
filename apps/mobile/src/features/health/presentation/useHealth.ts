import { useEffect, useState } from "react";
import type { HealthLink, HealthMetric } from "../domain/HealthModel.ts";
import type { HealthStorePort } from "../domain/HealthPorts.ts";

/** Привязка Health Connect (одна на рабочее пространство); `loaded` — пока чтение не завершилось, статус не показывается. Подписка снимается в cleanup. */
export function useHealthLink(store: HealthStorePort): Readonly<{ link: HealthLink | null; loaded: boolean }> {
  const [state, setState] = useState<Readonly<{ link: HealthLink | null }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void store.getLink().then((link) => { if (active) setState({ link }); }, () => undefined);
    return () => { active = false; };
  }, [store, tick]);
  useEffect(() => store.subscribeCommittedChanges(() => setTick((value) => value + 1)), [store]);
  return { link: state?.link ?? null, loaded: state !== null };
}

/**
 * Значения вида Health Connect по дням интервала для клиента; нет данных за день — нет ключа. `null` — ещё читается или чтение не удалось.
 * Данные остаются после отключения, поэтому читаются независимо от привязки.
 */
export function useHealthDaily(store: HealthStorePort, clientId: string, metric: HealthMetric, from: string, to: string): ReadonlyMap<string, number> | null {
  const key = `${clientId}|${metric}|${from}|${to}`;
  const [state, setState] = useState<Readonly<{ key: string; values: ReadonlyMap<string, number> }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void store.listDaily(clientId, from, to).then((days) => {
      if (active) setState({ key, values: new Map(days.filter((day) => day.metric === metric).map((day) => [day.localDate, day.value])) });
    }, () => undefined);
    return () => { active = false; };
  }, [store, clientId, metric, from, to, key, tick]);
  useEffect(() => store.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [store, clientId]);
  return state !== null && state.key === key ? state.values : null;
}
