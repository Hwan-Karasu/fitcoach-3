import type { RestSignalPort } from "../../features/training/public.ts";
import { clearRestSignals } from "../runtime/ClearRestSignals.ts";

const CHANNEL = "rest-timer";
const KIND = "rest-timer";

/**
 * Части expo-notifications загружаются точечно и лениво: корневой модуль пакета тянет push-подписку
 * (`ExpoTopicSubscriptionModule`), которой нет в Expo Go, и падает при импорте. Нет модуля — нет сигнала,
 * но таймер работает (§44.14).
 */
async function loadApi() {
  const [schedule, cancel, dismiss, channel, permissions, handler, types, channelTypes, scheduled, presented, emitter] = await Promise.all([
    import("expo-notifications/build/scheduleNotificationAsync"),
    import("expo-notifications/build/cancelScheduledNotificationAsync"),
    import("expo-notifications/build/dismissNotificationAsync"),
    import("expo-notifications/build/setNotificationChannelAsync"),
    import("expo-notifications/build/NotificationPermissions"),
    import("expo-notifications/build/NotificationsHandler"),
    import("expo-notifications/build/Notifications.types"),
    import("expo-notifications/build/NotificationChannelManager.types"),
    import("expo-notifications/build/getAllScheduledNotificationsAsync"),
    import("expo-notifications/build/getPresentedNotificationsAsync"),
    import("expo-notifications/build/NotificationsEmitter"),
  ]);
  // Отдельный канал таймера отдыха (§44.16–44.18): высокая важность, звук и вибрация; без будильника и DND.
  handler.setNotificationHandler({
    handleNotification: async (notification) => {
      // В открытом приложении окончание видно на панели таймеров: без баннера, только звук (§44.4).
      const restTimer = notification.request.content.data?.kind === KIND;
      return { shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: !restTimer, shouldShowList: !restTimer };
    },
  });
  await channel.setNotificationChannelAsync(CHANNEL, { name: "Таймер отдыха",
    importance: channelTypes.AndroidImportance.HIGH, vibrationPattern: [0, 400, 200, 400], sound: "default" });
  return { schedule, cancel, dismiss, permissions, types, scheduled, presented, emitter };
}

let api: ReturnType<typeof loadApi> | null = null;
let asked = false;

const available = () => {
  const pending = (api ??= loadApi());
  // Разовый сбой загрузки не отключает сигнал до перезапуска: кэш сбрасывается.
  return pending.catch(() => { if (api === pending) api = null; return null; });
};

/** Разрешение спрашивается один раз за запуск; отказ не блокирует таймер (§44.14). */
async function allowed(permissions: Awaited<ReturnType<typeof loadApi>>["permissions"], requestPermission: boolean): Promise<boolean> {
  const current = await permissions.getPermissionsAsync();
  if (current.granted) return true;
  if (!requestPermission || asked || !current.canAskAgain) return false;
  asked = true;
  return (await permissions.requestPermissionsAsync()).granted;
}

export const expoRestSignal: RestSignalPort = {
  async schedule({ endAt, title, body, route, requestPermission = true }) {
    const notifications = await available();
    if (notifications === null || !(await allowed(notifications.permissions, requestPermission).catch(() => false)) || endAt <= Date.now()) return null;
    return notifications.schedule.scheduleNotificationAsync({
      content: { title, body, sound: "default", data: { kind: KIND, ...route } },
      trigger: { type: notifications.types.SchedulableTriggerInputTypes.DATE, date: endAt, channelId: CHANNEL },
    });
  },
  async cancel(signalId) {
    const notifications = await available();
    if (notifications === null) return;
    await notifications.cancel.cancelScheduledNotificationAsync(signalId).catch(() => undefined);
    await notifications.dismiss.dismissNotificationAsync(signalId).catch(() => undefined);
  },
  async clearOwned() {
    const notifications = await available(); if (notifications === null) return;
    await clearRestSignals({ scheduled: notifications.scheduled.getAllScheduledNotificationsAsync,
      presented: notifications.presented.getPresentedNotificationsAsync,
      response: notifications.emitter.getLastNotificationResponseAsync,
      cancel: notifications.cancel.cancelScheduledNotificationAsync, dismiss: notifications.dismiss.dismissNotificationAsync,
      clearResponse: notifications.emitter.clearLastNotificationResponseAsync });
  },
};

/** Загрузить части уведомлений заранее, при старте, не дожидаясь: первый таймер не ждёт модуль. */
export function preloadRestSignal(): void {
  void available();
}
