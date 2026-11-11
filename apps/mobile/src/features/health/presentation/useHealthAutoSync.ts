import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { shouldResyncHealth } from "../domain/HealthRules.ts";

/**
 * Обновление Health Connect без ручных действий (UIX-FIT-12, ADR-074): читает при открытии привязанной карточки и при каждом возврате приложения на передний план
 * (например, из Mi Fitness, который кладёт данные в Health Connect только в момент своей синхронизации с браслетом). Не чаще раза в `HEALTH_RESYNC_MIN_GAP_MS`;
 * параллельные запросы схлопывает очередь операций. В фоне ничего не читается (ADR-059). Ошибки не всплывают: прежние данные остаются на экране.
 * `scopeKey` — клиент: смена карточки снова читает без паузы. Подписка снимается в cleanup.
 */
export function useHealthAutoSync(sync: () => Promise<unknown>, enabled: boolean, scopeKey: string): void {
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (!enabled) return undefined;
    let lastRunAt: number | null = null;
    const run = () => {
      const now = Date.now();
      if (!shouldResyncHealth(lastRunAt, now)) return;
      lastRunAt = now;
      void syncRef.current().catch(() => undefined);
    };
    run();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") run(); });
    return () => subscription.remove();
  }, [enabled, scopeKey]);
}
