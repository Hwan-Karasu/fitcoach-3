import { todayLocal } from "./nutritionFormat.ts";
import { msUntilNextLocalDay } from "./todayClock.ts";

/** Один таймер полуночи и один AppState-listener на все экраны; последняя отписка освобождает оба. */
export function createLocalDayStore(listenActive: (listener: () => void) => () => void) {
  let today = todayLocal();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const refresh = () => {
    const next = todayLocal();
    if (next !== today) { today = next; listeners.forEach((listener) => listener()); }
    if (timer !== undefined) clearTimeout(timer);
    if (listeners.size > 0) timer = setTimeout(refresh, msUntilNextLocalDay(new Date()));
  };
  return {
    getSnapshot: () => listeners.size === 0 ? todayLocal() : today,
    subscribe(listener: () => void) {
      const first = listeners.size === 0;
      listeners.add(listener);
      if (first) { refresh(); stop = listenActive(refresh); }
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        if (listeners.size === 0) { clearTimeout(timer); timer = undefined; stop?.(); stop = undefined; }
      };
    },
  };
}
