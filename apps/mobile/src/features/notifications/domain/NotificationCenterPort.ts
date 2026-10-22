import type { CenterCandidate, CenterEvent } from "./CenterModel.ts";
import type { NotificationSettings } from "./NotificationSettings.ts";

export interface NotificationsCommittedChange {
  readonly scope: "SETTINGS" | "EVENTS";
}

/**
 * Настройки и лента уведомлений тренера (§§41, 54). Ошибки: NOTIFICATION_SETTINGS_INVALID, NOTIFICATION_EVENT_NOT_FOUND;
 * неудачная запись статуса пробрасывается — UI не изображает её сохранённой (§54.5 п.6).
 */
export interface NotificationCenterPort {
  getSettings(): Promise<NotificationSettings>;
  saveSettings(settings: NotificationSettings): Promise<NotificationSettings>;
  /**
   * Добавляет в ленту события, которых там ещё нет (в том числе уже прочитанные и убранные — они не возвращаются), и удаляет
   * строки старше срока хранения. События старше срока не создаются. Идемпотентна; возвращает число новых строк.
   */
  materialize(candidates: readonly CenterCandidate[], now: Date): Promise<number>;
  /** Не убранные строки, новые сверху. */
  listFeed(): Promise<readonly CenterEvent[]>;
  /** Непрочитанные и не убранные. */
  unreadCount(): Promise<number>;
  markRead(id: string, now?: Date): Promise<void>;
  markAllRead(now?: Date): Promise<void>;
  /** Убирает строку из ленты (свайп); сама запись остаётся, чтобы то же событие не вернулось. */
  dismiss(id: string, now?: Date): Promise<void>;
  /** «Отменить» после свайпа. */
  undoDismiss(id: string): Promise<void>;
  /** «Очистить прочитанные»: прочитанные строки убираются из ленты. */
  clearRead(now?: Date): Promise<number>;
  subscribeCommittedChanges(listener: (change: NotificationsCommittedChange) => void): () => void;
}
