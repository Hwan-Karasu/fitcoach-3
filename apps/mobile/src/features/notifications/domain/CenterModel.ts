import type { NotificationSettings, RetentionDays } from "./NotificationSettings.ts";
import { localMoment, type ReminderIntent } from "./ReminderPlanner.ts";

export type CenterSourceType = "APPOINTMENT" | "DUTY" | "BACKUP";
export type CenterEventKind = "REMINDER" | "OUTCOME_DUE" | "BACKUP_FAILED";

/** Строка ленты центра. Прочтение и скрытие — только про представление, бизнес-данные не затрагивают (§54.2). */
export interface CenterEvent {
  readonly id: string;
  readonly sourceType: CenterSourceType;
  readonly sourceId: string;
  readonly eventKind: CenterEventKind;
  readonly eventVersion: string;
  readonly clientId: string | null;
  readonly title: string;
  readonly body: string;
  /** Момент события (ISO): когда напоминание должно было сработать, исход стал ждать решения и т. п. */
  readonly occursAt: string;
  readonly readAt: string | null;
}

/** Кандидат в ленту; устойчивая identity — `(sourceType, sourceId, eventKind, eventVersion)` в рамках рабочего пространства (§54.5 п.1). */
export type CenterCandidate = Omit<CenterEvent, "id" | "readAt">;

/** Запись календаря глазами «пора выбрать исход». */
export interface OutcomeAppointment {
  readonly id: string;
  readonly localDate: string;
  readonly startMinute: number;
  readonly durationMinutes: number;
  readonly lifecycle: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  readonly outcome: "COMPLETED" | "MISSED" | "CANCELLED" | null;
  readonly clientId: string | null;
  readonly participantName: string | null;
  readonly sessionTypeName: string;
}

export function candidateFromReminder(intent: ReminderIntent): CenterCandidate {
  return { sourceType: intent.sourceType, sourceId: intent.sourceId, eventKind: intent.eventKind, eventVersion: intent.eventVersion,
    clientId: intent.clientId, title: intent.title, body: intent.body, occursAt: intent.fireAt.toISOString() };
}

/**
 * Записи, время которых закончилось, а исход не выбран (§§48.35.3, 54.1 п.2). Событие не выбирает исход и не трогает абонемент;
 * версия фиксирована: один раз на запись, убранная свайпом строка не возвращается.
 */
export function outcomeDueCandidates(appointments: readonly OutcomeAppointment[], now: Date): readonly CenterCandidate[] {
  return appointments.flatMap((item): CenterCandidate[] => {
    if (item.lifecycle !== "SCHEDULED" || item.outcome !== null) return [];
    const endsAt = localMoment(item.localDate, item.startMinute + item.durationMinutes);
    if (endsAt.getTime() > now.getTime()) return [];
    const who = item.participantName?.trim() ? item.participantName.trim() : "Без имени";
    const hh = String(Math.floor(item.startMinute / 60)).padStart(2, "0");
    const mm = String(item.startMinute % 60).padStart(2, "0");
    return [{ sourceType: "APPOINTMENT", sourceId: item.id, eventKind: "OUTCOME_DUE", eventVersion: "1", clientId: item.clientId,
      title: "Выберите исход записи", body: `${item.localDate.slice(8, 10)}.${item.localDate.slice(5, 7)} ${hh}:${mm} · ${who} · ${item.sessionTypeName}`,
      occursAt: endsAt.toISOString() }];
  });
}

/** Граница хранения: события старше срока в ленту не попадают и не создаются заново из источника. */
export function retentionCutoff(retentionDays: RetentionDays, now: Date): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export type { NotificationSettings };
