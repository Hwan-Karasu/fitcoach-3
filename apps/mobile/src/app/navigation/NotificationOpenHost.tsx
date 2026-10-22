import { useEffect, useRef } from "react";
import type { NavigationContainerRefWithCurrent, ParamListBase } from "@react-navigation/native";
import { subscribeNotificationOpen, takeLaunchNotificationOpen } from "../composition/expoNotificationOpen.ts";
import { targetOfPayload, type NotificationTarget } from "./notificationTarget.ts";

/**
 * Принимает нажатия на системные уведомления (напоминания календаря и «Отдых окончен») и открывает нужный раздел. Нажатие, пришедшее раньше,
 * чем готова навигация (холодный старт), ждёт её готовности. Повреждённая нагрузка — приложение открывается без перехода.
 */
export function NotificationOpenHost({ navigationRef, onTarget }: Readonly<{ navigationRef: NavigationContainerRefWithCurrent<ParamListBase>;
  onTarget: (target: NotificationTarget) => void }>) {
  const pending = useRef<NotificationTarget | null>(null);
  const handler = useRef(onTarget);
  handler.current = onTarget;

  useEffect(() => {
    let active = true;
    let poll: ReturnType<typeof setInterval> | null = null;
    const deliver = (target: NotificationTarget | null) => {
      if (target === null) return;
      if (navigationRef.isReady()) { handler.current(target); return; }
      pending.current = target;
      if (poll !== null) return;
      // Контейнер навигации поднимается сразу после первого кадра: ждём его коротким опросом, без таймаута-ловушки.
      let attempts = 0;
      poll = setInterval(() => {
        attempts += 1;
        if (navigationRef.isReady() && pending.current !== null) { const next = pending.current; pending.current = null; handler.current(next); }
        if (navigationRef.isReady() || attempts > 40) { if (poll !== null) clearInterval(poll); poll = null; }
      }, 250);
    };
    const off = subscribeNotificationOpen((data) => { if (active) deliver(targetOfPayload(data)); });
    void takeLaunchNotificationOpen().then((data) => { if (active) deliver(targetOfPayload(data)); });
    return () => { active = false; off(); if (poll !== null) clearInterval(poll); };
  }, [navigationRef]);

  return null;
}
