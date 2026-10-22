import { Linking } from "react-native";
import type { OsPermission, PlatformNotificationPort } from "../domain/PlatformNotificationPort.ts";
import { REMINDER_PREFIX } from "../domain/ReminderReconciler.ts";

const CHANNEL = "calendar-reminders";

/**
 * Части expo-notifications загружаются точечно и лениво (как у сигнала таймера отдыха): корневой модуль пакета тянет push-подписку,
 * которой нет в Expo Go. Обработчик показа в открытом приложении задаёт сигнал таймера; напоминания показываются штатно.
 */
async function loadApi() {
  const [schedule, cancel, scheduled, channel, permissions, types, channelTypes] = await Promise.all([
    import("expo-notifications/build/scheduleNotificationAsync"),
    import("expo-notifications/build/cancelScheduledNotificationAsync"),
    import("expo-notifications/build/getAllScheduledNotificationsAsync"),
    import("expo-notifications/build/setNotificationChannelAsync"),
    import("expo-notifications/build/NotificationPermissions"),
    import("expo-notifications/build/Notifications.types"),
    import("expo-notifications/build/NotificationChannelManager.types"),
  ]);
  await channel.setNotificationChannelAsync(CHANNEL, { name: "Напоминания календаря", importance: channelTypes.AndroidImportance.DEFAULT });
  return { schedule, cancel, scheduled, permissions, types };
}

let api: ReturnType<typeof loadApi> | null = null;
const available = () => (api ??= loadApi());

const toPermission = (state: { granted: boolean; canAskAgain: boolean }): OsPermission =>
  state.granted ? "granted" : state.canAskAgain ? "undetermined" : "denied";

export const expoNotificationAdapter: PlatformNotificationPort = {
  async permission() {
    return toPermission(await (await available()).permissions.getPermissionsAsync());
  },
  async requestPermission() {
    return toPermission(await (await available()).permissions.requestPermissionsAsync());
  },
  async scheduledIds() {
    const all = await (await available()).scheduled.getAllScheduledNotificationsAsync();
    return all.map((item) => item.identifier).filter((id) => id.startsWith(REMINDER_PREFIX));
  },
  async schedule({ identifier, title, body, fireAt }) {
    const notifications = await available();
    await notifications.schedule.scheduleNotificationAsync({ identifier, content: { title, body, sound: "default", data: { kind: "calendar-reminder" } },
      trigger: { type: notifications.types.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: CHANNEL } });
  },
  async cancel(identifiers) {
    const notifications = await available();
    for (const identifier of identifiers) await notifications.cancel.cancelScheduledNotificationAsync(identifier);
  },
  async openSystemSettings() {
    await Linking.openSettings();
  },
};
