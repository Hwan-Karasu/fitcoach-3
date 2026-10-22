import { isQuietMinute, type NotificationSettings } from "./NotificationSettings.ts";

/** Запись календаря глазами планировщика: только то, что нужно для напоминания. */
export interface PlannerAppointment {
  readonly id: string;
  readonly localDate: string;
  readonly startMinute: number;
  readonly lifecycle: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  /** Имя клиента или гостя; null — без имени. */
  readonly participantName: string | null;
  readonly sessionTypeName: string;
}

export interface PlannerDuty {
  readonly id: string;
  readonly localDate: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** Что нужно показать и когда. Календарь остаётся источником расписания: набор строится заново из него (§41.2). */
export interface ReminderIntent {
  readonly sourceType: "APPOINTMENT" | "DUTY";
  readonly sourceId: string;
  readonly eventKind: "REMINDER";
  /** Меняется вместе со временем срабатывания и текстом: новая версия — новое событие центра, прежняя запись остаётся историей. */
  readonly eventVersion: string;
  readonly fireAt: Date;
  readonly startsAt: Date;
  readonly title: string;
  readonly body: string;
}

const pad = (value: number) => String(value).padStart(2, "0");
export const clockText = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** Локальная дата `ГГГГ-ММ-ДД` и минуты от полуночи → момент времени в часовом поясе устройства. */
export function localMoment(localDate: string, minute: number): Date {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 0, minute, 0, 0);
}

function minuteOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

/** «через 1 ч 30 мин» / «через 45 мин» — без ложной точности. */
export function leadText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} мин` : rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function fireTimeAllowed(settings: NotificationSettings, fireAt: Date, now: Date): boolean {
  // Просроченное напоминание задним числом не создаётся (§54.5 п.3); попавшее в тихие часы подавляется и не переносится (§41.9).
  return fireAt.getTime() > now.getTime() && !isQuietMinute(settings.quietHours, minuteOfDay(fireAt));
}

/**
 * Полный набор будущих напоминаний по текущим данным календаря и настройкам. Идемпотентен: одинаковые входы дают одинаковый результат,
 * поэтому перепланирование после любого коммита календаря не плодит дубли. На запись и на дежурство — не больше одного напоминания (§41.4).
 */
export function planReminders(input: Readonly<{ settings: NotificationSettings; appointments: readonly PlannerAppointment[];
  duties: readonly PlannerDuty[]; now: Date }>): readonly ReminderIntent[] {
  const { settings, now } = input;
  const intents: ReminderIntent[] = [];
  if (settings.appointment.enabled) {
    for (const item of input.appointments) {
      if (item.lifecycle !== "SCHEDULED") continue;
      const startsAt = localMoment(item.localDate, item.startMinute);
      const fireAt = new Date(startsAt.getTime() - settings.appointment.minutesBefore * 60_000);
      if (!fireTimeAllowed(settings, fireAt, now)) continue;
      const who = item.participantName?.trim() ? item.participantName.trim() : "Без имени";
      intents.push({ sourceType: "APPOINTMENT", sourceId: item.id, eventKind: "REMINDER",
        eventVersion: `${fireAt.getTime()}:${who}:${item.sessionTypeName}`, fireAt, startsAt,
        title: `Запись ${leadText(settings.appointment.minutesBefore)} до начала`,
        body: `${clockText(item.startMinute)} · ${who} · ${item.sessionTypeName}` });
    }
  }
  if (settings.duty.enabled) {
    for (const item of input.duties) {
      const startsAt = localMoment(item.localDate, item.startMinute);
      const fireAt = new Date(startsAt.getTime() - settings.duty.minutesBefore * 60_000);
      if (!fireTimeAllowed(settings, fireAt, now)) continue;
      intents.push({ sourceType: "DUTY", sourceId: item.id, eventKind: "REMINDER",
        eventVersion: `${fireAt.getTime()}:${item.endMinute}`, fireAt, startsAt,
        title: `Дежурство ${leadText(settings.duty.minutesBefore)} до начала`,
        body: `${clockText(item.startMinute)}–${clockText(item.endMinute)}` });
    }
  }
  return intents.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.sourceId.localeCompare(b.sourceId));
}
