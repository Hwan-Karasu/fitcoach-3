import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { CalendarRepositoryPort } from "../../features/calendar/public.ts";
import type { NotificationCenterPort } from "../../features/notifications/public.ts";
import type { NotificationSync } from "../../workflows/syncNotifications.ts";

const UnreadContext = createContext(0);

/** Число непрочитанных и не убранных строк центра для значка на колокольчике (§54.3). */
export function useUnreadNotifications(): number {
  return useContext(UnreadContext);
}

const RESYNC_MS = 60_000;

/**
 * Держит напоминания и ленту в согласии с календарём: сверка при запуске, возврате в приложение, после коммита календаря и смены настроек,
 * а при открытом приложении — раз в минуту (наступившие события попадают в ленту). Значок обновляется из хранилища без пересоздания навигации.
 * Сбой сверки не мешает работе: следующий запуск досчитывает недостающее.
 */
export function NotificationsHost({ center, calendar, sync, children }: Readonly<{ center: NotificationCenterPort;
  calendar: Pick<CalendarRepositoryPort, "subscribeCommittedChanges">; sync: NotificationSync; children: ReactNode }>) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => { sync.run().catch(() => undefined); };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, 400);
    };
    const refreshBadge = () => { center.unreadCount().then((count) => { if (active) setUnread(count); }, () => undefined); };
    run();
    refreshBadge();
    const offCalendar = calendar.subscribeCommittedChanges(schedule);
    const offCenter = center.subscribeCommittedChanges((change) => {
      refreshBadge();
      if (change.scope === "SETTINGS") schedule();
    });
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") { run(); refreshBadge(); } });
    const interval = setInterval(run, RESYNC_MS);
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      clearInterval(interval);
      offCalendar();
      offCenter();
      appState.remove();
    };
  }, [center, calendar, sync]);

  return <UnreadContext.Provider value={unread}>{children}</UnreadContext.Provider>;
}
