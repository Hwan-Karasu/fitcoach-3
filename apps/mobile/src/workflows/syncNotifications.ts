import type { CalendarParticipantDirectoryPort, CalendarRepositoryPort } from "../features/calendar/public.ts";
import type { candidateFromReminder, diffSchedule, dueReminders, outcomeDueCandidates, planReminders, reminderIdentifier, withinHorizon,
  CenterCandidate, NotificationCenterPort, OsPermission, PlannerAppointment, PlannerDuty, PlatformNotificationPort } from "../features/notifications/public.ts";

/** Чистые правила владельца уведомлений подставляет composition root: workflow остаётся type-only к public API фичи. */
export interface NotificationRules {
  readonly planReminders: typeof planReminders;
  readonly dueReminders: typeof dueReminders;
  readonly candidateFromReminder: typeof candidateFromReminder;
  readonly outcomeDueCandidates: typeof outcomeDueCandidates;
  readonly diffSchedule: typeof diffSchedule;
  readonly reminderIdentifier: typeof reminderIdentifier;
  readonly withinHorizon: typeof withinHorizon;
  readonly horizonDays: number;
}

export interface NotificationSyncResult {
  readonly permission: OsPermission;
  /** Сколько напоминаний FitCoach сейчас стоит в ОС после сверки. */
  readonly scheduled: number;
  /** Новые строки ленты центра. */
  readonly feedAdded: number;
  /** Ошибка сверки с ОС; лента и календарь от неё не зависят (§54.5 п.4). */
  readonly osError: boolean;
}

export interface NotificationSync {
  /**
   * Календарь остаётся единственным источником расписания (§41.2): из него и настроек строится полный набор напоминаний,
   * ОС приводится к нему (отмена лишних, добавление недостающих), а наступившие события попадают в ленту центра.
   * Идемпотентна: вызывается при запуске, возврате в приложение, после коммита календаря и смены настроек.
   * `scope`: `FULL` (по умолчанию) просматривает записи за весь срок хранения ленты — находит и давно неразобранные; `TICK` — лёгкая минутная
   * сверка за вчера и вперёд, пока приложение открыто.
   */
  run(now?: Date, scope?: "FULL" | "TICK"): Promise<NotificationSyncResult>;
}

const pad = (value: number) => String(value).padStart(2, "0");
const dateText = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

export function createNotificationSync(rules: NotificationRules, ports: Readonly<{ calendar: Pick<CalendarRepositoryPort, "listRange">;
  participants: Pick<CalendarParticipantDirectoryPort, "listParticipants">; center: Pick<NotificationCenterPort, "getSettings" | "materialize">;
  platform: PlatformNotificationPort }>): NotificationSync {
  let chain: Promise<unknown> = Promise.resolve();
  async function once(now: Date, scope: "FULL" | "TICK"): Promise<NotificationSyncResult> {
    const settings = await ports.center.getSettings();
    // Окно: назад — на срок хранения ленты (записи, давно ждущие исхода) либо только на вчера при минутной сверке; вперёд — горизонт планирования.
    const back = scope === "FULL" ? settings.retentionDays : 1;
    const from = dateText(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
    const to = dateText(new Date(now.getFullYear(), now.getMonth(), now.getDate() + rules.horizonDays));
    const [range, people] = await Promise.all([ports.calendar.listRange(from, to), ports.participants.listParticipants()]);
    const names = new Map(people.map((person) => [person.id, person.displayName]));
    const appointments: PlannerAppointment[] = range.appointments.map((item) => ({ id: item.id, localDate: item.localDate, startMinute: item.startMinute,
      lifecycle: item.lifecycle, clientId: item.clientId, participantName: item.clientId === null ? item.guestName : (names.get(item.clientId) ?? item.guestName),
      sessionTypeName: item.sessionTypeName }));
    const duties: PlannerDuty[] = range.intervals.filter((item) => item.kind === "DUTY")
      .map((item) => ({ id: item.id, localDate: item.localDate, startMinute: item.startMinute, endMinute: item.endMinute }));

    // Лента центра не зависит от разрешения ОС (§54.5 п.4).
    const candidates: CenterCandidate[] = [
      ...rules.dueReminders({ settings, appointments, duties, now }).map(rules.candidateFromReminder),
      ...rules.outcomeDueCandidates(range.appointments.map((item) => ({ id: item.id, localDate: item.localDate, startMinute: item.startMinute,
        durationMinutes: item.durationMinutes, lifecycle: item.lifecycle, outcome: item.outcome, clientId: item.clientId,
        participantName: item.clientId === null ? item.guestName : (names.get(item.clientId) ?? item.guestName), sessionTypeName: item.sessionTypeName })), now),
    ];
    const feedAdded = await ports.center.materialize(candidates, now);

    let permission: OsPermission = "undetermined";
    let scheduled = 0;
    let osError = false;
    try {
      permission = await ports.platform.permission();
      const existing = await ports.platform.scheduledIds();
      // Без разрешения в ОС ничего не планируется, но прежние напоминания снимаются, если настройка выключена.
      const desired = permission === "granted" ? rules.withinHorizon(rules.planReminders({ settings, appointments, duties, now }), now) : [];
      const diff = rules.diffSchedule(desired, existing);
      await ports.platform.cancel(diff.toCancel);
      for (const intent of diff.toSchedule) {
        await ports.platform.schedule({ identifier: rules.reminderIdentifier(intent), title: intent.title, body: intent.body, fireAt: intent.fireAt,
          target: { sourceType: intent.sourceType, eventKind: intent.eventKind, clientId: intent.clientId } });
      }
      scheduled = desired.length;
    } catch {
      osError = true;
    }
    return { permission, scheduled, feedAdded, osError };
  }
  return {
    // Запуски идут по очереди: два одновременных вызова (запуск + коммит календаря) не планируют одно и то же дважды.
    run: (now = new Date(), scope = "FULL") => {
      const next = chain.then(() => once(now, scope), () => once(now, scope));
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
