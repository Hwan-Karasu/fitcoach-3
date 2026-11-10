import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Haptics from "expo-haptics";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { RestFinishTracker } from "../domain/RestFinishTracker.ts";
import { nextFinishAt } from "../domain/RestTimerRules.ts";
import { restTimerDiagnostics } from "../../../../shared/diagnostics/RestTimerDiagnostics.ts";

/** Одна подписка и один ближайший deadline; контроллер не зависит от вида панели или навигатора. */
export function useRestPanelController(timers: RestTimersPort) {
  const subscribe = useCallback((listener: () => void) => timers.subscribe(listener), [timers]);
  const snapshot = useCallback(() => timers.list(), [timers]);
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [now, setNow] = useState(Date.now);
  const [active, setActive] = useState(AppState.currentState === "active");
  const tracker = useRef(new RestFinishTracker()).current;
  const pending = useRef(new Set<ReturnType<typeof setTimeout>>()).current;
  const wake = useCallback(() => setNow(Date.now()), []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      restTimerDiagnostics.event(state === "active" ? "active" : "background");
      setActive(state === "active");
      if (state === "active") wake();
    });
    return () => subscription.remove();
  }, [wake]);
  useEffect(() => {
    restTimerDiagnostics.reportActive(list.length);
    if (!active) return undefined;
    const at = nextFinishAt(list, now);
    if (at === null) return undefined;
    const handle = setTimeout(wake, Math.max(0, at - Date.now()));
    return () => clearTimeout(handle);
  }, [list, now, active, wake]);
  useEffect(() => {
    if (!active) return;
    const fresh = tracker.observe(list, Math.max(now, Date.now()));
    if (fresh.length === 0) return;
    wake();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    for (const { id, endAt } of fresh) {
      const handle = setTimeout(() => {
        pending.delete(handle);
        void timers.dismissFinished(id, endAt).catch(() => undefined);
      }, 4000);
      pending.add(handle);
    }
  }, [list, now, active, timers, tracker, pending, wake]);
  useEffect(() => () => { for (const handle of pending) clearTimeout(handle); pending.clear(); }, [pending]);
  return { list, now, active };
}
