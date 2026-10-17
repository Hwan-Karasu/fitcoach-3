import type { RestSignalPort } from "../../features/training/public.ts";

const CHANNEL = "rest-timer";
const KIND = "rest-timer";

/**
 * Части expo-notifications загружаются точечно и лениво: корневой модуль пакета тянет push-подписку
 * (`ExpoTopicSubscriptionModule`), которой нет в Expo Go, и падает при импорте. Нет модуля — нет сигнала,
 * но таймер работает (§44.14).
 */
async function loadApi() {
  const [schedule, cancel, dismiss, channel, permissions, handler, types, channelTypes] = await Promise.all([
    import("expo-notifications/build/scheduleNotificationAsync"),
    import("expo-notifications/build/cancelScheduledNotificationAsync"),
    import("expo-notifications/build/dismissNotificationAsync"),
    import("expo-notifications/build/setNotificationChannelAsync"),
    import("expo-notifications/build/NotificationPermissions"),
    import("expo-notifications/build/NotificationsHandler"),
    import("expo-notifications/build/Notifications.types"),
    import("expo-notifications/build/NotificationChannelManager.types"),
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
  return { schedule, cancel, dismiss, permissions, types };
}

let api: ReturnType<typeof loadApi> | null = null;
let asked = false;

const available = () => {
  api ??= loadApi();
  return api.catch(() => null);
};

/** Разрешение спрашивается один раз за запуск; отказ не блокирует таймер (§44.14). */
async function allowed(permissions: Awaited<ReturnType<typeof loadApi>>["permissions"]): Promise<boolean> {
  const current = await permissions.getPermissionsAsync();
  if (current.granted) return true;
  if (asked || !current.canAskAgain) return false;
  asked = true;
  return (await permissions.requestPermissionsAsync()).granted;
}

export const expoRestSignal: RestSignalPort = {
  async schedule({ endAt, title, body }) {
    const notifications = await available();
    if (notifications === null || !(await allowed(notifications.permissions).catch(() => false))) return null;
    return notifications.schedule.scheduleNotificationAsync({
      content: { title, body, sound: "default", data: { kind: KIND } },
      trigger: { type: notifications.types.SchedulableTriggerInputTypes.DATE, date: endAt, channelId: CHANNEL },
    });
  },
  async cancel(signalId) {
    const notifications = await available();
    if (notifications === null) return;
    await notifications.cancel.cancelScheduledNotificationAsync(signalId).catch(() => undefined);
    await notifications.dismiss.dismissNotificationAsync(signalId).catch(() => undefined);
  },
};
