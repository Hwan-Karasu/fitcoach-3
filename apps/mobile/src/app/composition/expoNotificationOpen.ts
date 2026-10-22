/**
 * Нажатие на системное уведомление (календарь и таймер отдыха): части expo-notifications загружаются точечно и лениво, как у сигнала таймера
 * (корневой модуль пакета тянет push-подписку, которой нет в Expo Go). Нет модуля — приложение просто открывается без перехода.
 */
async function loadEmitter() {
  return import("expo-notifications/build/NotificationsEmitter");
}

/** Подписка на нажатия, пока приложение запущено; возвращает отписку. */
export function subscribeNotificationOpen(listener: (data: unknown) => void): () => void {
  let active = true;
  let remove: (() => void) | null = null;
  void loadEmitter().then((emitter) => {
    if (!active) return;
    const subscription = emitter.addNotificationResponseReceivedListener((response) => {
      listener(response.notification.request.content.data);
      void emitter.clearLastNotificationResponseAsync().catch(() => undefined);
    });
    remove = () => subscription.remove();
  }, () => undefined);
  return () => { active = false; remove?.(); };
}

/** Нажатие, с которого запущено приложение (холодный старт); после чтения сбрасывается, чтобы не сработать повторно. */
export async function takeLaunchNotificationOpen(): Promise<unknown> {
  try {
    const emitter = await loadEmitter();
    const response = await emitter.getLastNotificationResponseAsync();
    if (response === null) return null;
    await emitter.clearLastNotificationResponseAsync().catch(() => undefined);
    return response.notification.request.content.data;
  } catch {
    return null;
  }
}
