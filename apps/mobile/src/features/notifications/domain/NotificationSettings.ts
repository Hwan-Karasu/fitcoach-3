/** Интервал «до начала» в минутах: 1 минута – 24 часа включительно (§41.4). */
export const MIN_REMINDER_MINUTES = 1;
export const MAX_REMINDER_MINUTES = 1440;
export const RETENTION_CHOICES = [30, 90, 180, 365] as const;
export type RetentionDays = typeof RETENTION_CHOICES[number];

export interface ReminderSetting {
  readonly enabled: boolean;
  readonly minutesBefore: number;
}

export interface QuietHours {
  readonly enabled: boolean;
  /** Минуты от локальной полуночи; интервал может переходить через полночь (22:00–08:00). */
  readonly startMinute: number;
  readonly endMinute: number;
}

/** Настройки уведомлений тренера (§§41, 54). Rest Timer не настраивается (§41.10). */
export interface NotificationSettings {
  readonly appointment: ReminderSetting;
  readonly duty: ReminderSetting;
  readonly quietHours: QuietHours;
  readonly retentionDays: RetentionDays;
}

/** Напоминания выключены, пока тренер сам не включит (разрешение ОС запрашивается в этот момент, §41.12); тихие часы выключены (§41.9). */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  appointment: { enabled: false, minutesBefore: 60 },
  duty: { enabled: false, minutesBefore: 60 },
  quietHours: { enabled: false, startMinute: 22 * 60, endMinute: 8 * 60 },
  retentionDays: 90,
};

export function isValidMinutesBefore(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_REMINDER_MINUTES && value <= MAX_REMINDER_MINUTES;
}

/** Проверка перед записью; неверное значение не заменяется молча. */
export function validateNotificationSettings(settings: NotificationSettings): NotificationSettings {
  if (!isValidMinutesBefore(settings.appointment.minutesBefore) || !isValidMinutesBefore(settings.duty.minutesBefore)) {
    throw new Error("NOTIFICATION_SETTINGS_INVALID");
  }
  const { startMinute, endMinute } = settings.quietHours;
  const validMinute = (minute: number) => Number.isInteger(minute) && minute >= 0 && minute < 1440;
  // Совпадающие границы — пустой или сутки целиком: неоднозначно, поэтому не допускаются.
  if (!validMinute(startMinute) || !validMinute(endMinute) || startMinute === endMinute) throw new Error("NOTIFICATION_SETTINGS_INVALID");
  if (!RETENTION_CHOICES.includes(settings.retentionDays)) throw new Error("NOTIFICATION_SETTINGS_INVALID");
  return settings;
}

/** Попадает ли минута суток в тихие часы; интервал [start, end), через полночь — если start > end. */
export function isQuietMinute(quiet: QuietHours, minuteOfDay: number): boolean {
  if (!quiet.enabled) return false;
  return quiet.startMinute < quiet.endMinute
    ? minuteOfDay >= quiet.startMinute && minuteOfDay < quiet.endMinute
    : minuteOfDay >= quiet.startMinute || minuteOfDay < quiet.endMinute;
}
