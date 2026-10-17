import type { AccountingRepositoryPort, ClientAccountingSnapshot } from "../features/accounting/public.ts";
import type { Appointment, CalendarRepositoryPort } from "../features/calendar/public.ts";
import type { RosterClientOverview, RosterOverview, RosterOverviewPort } from "../features/clients/public.ts";
import type { Answers, QuestionnaireRepositoryPort } from "../features/questionnaire/public.ts";
import { packSummary, type HomeSummaryRules } from "./clientHomeSummary.ts";

/** Насколько вперёд ищем «следующее занятие». */
const LOOKAHEAD_DAYS = 90;

/** Ответы раздела «Здоровье» стандартной анкеты, которые означают ограничения. */
const healthTextFields = ["sys:health.diagnoses", "sys:health.injuries", "sys:health.surgeries", "sys:health.pain"];

function shiftDate(date: string, days: number): string {
  const value = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days));
  return value.toISOString().slice(0, 10);
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function formatNext(appointment: Appointment, today: string): string {
  const time = clock(appointment.startMinute);
  if (appointment.localDate === today) return `Сегодня ${time}`;
  if (appointment.localDate === shiftDate(today, 1)) return `Завтра ${time}`;
  return `${appointment.localDate.slice(8, 10)}.${appointment.localDate.slice(5, 7)} ${time}`;
}

/** Явный ответ «есть противопоказания» или заполненное поле о здоровье; текст наружу не выходит. */
export function hasRestrictions(answers: Answers | null): boolean {
  if (answers === null) return false;
  if (answers["sys:health.noContra"] === false) return true;
  return healthTextFields.some((id) => {
    const value = answers[id];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function credits(rules: HomeSummaryRules, snapshot: ClientAccountingSnapshot | null, today: string): string | null {
  const pack = packSummary(rules, snapshot, today);
  if (pack.kind === "UNAVAILABLE") return null;
  if (pack.kind === "NOT_TRACKED") return "Без учёта";
  if (pack.kind === "NO_PACK") return "Нет пакета";
  return `${pack.available} зан.`;
}

/** Чистая проекция фактов календаря, учёта и анкеты на карточки списка. */
export function buildRosterOverview(input: Readonly<{
  rules: HomeSummaryRules;
  clientIds: readonly string[];
  appointments: readonly Appointment[];
  accounting: ReadonlyMap<string, ClientAccountingSnapshot | null>;
  answers: ReadonlyMap<string, Answers | null>;
  today: string;
  nowMinute: number;
}>): RosterOverview {
  const byClient = new Map<string, Appointment[]>();
  for (const row of input.appointments) {
    if (row.clientId === null || row.lifecycle === "CANCELLED") continue;
    const list = byClient.get(row.clientId) ?? [];
    list.push(row);
    byClient.set(row.clientId, list);
  }
  const result = new Map<string, RosterClientOverview>();
  for (const clientId of input.clientIds) {
    const rows = (byClient.get(clientId) ?? []).sort((a, b) =>
      a.localDate.localeCompare(b.localDate) || a.startMinute - b.startMinute);
    const next = rows.find((row) => row.lifecycle === "SCHEDULED"
      && (row.localDate > input.today || (row.localDate === input.today && row.startMinute >= input.nowMinute)));
    // §7: сегодняшняя неотменённая запись держит клиента в фильтре до своего конца.
    const today = rows.find((row) => row.localDate === input.today
      && row.startMinute + row.durationMinutes > input.nowMinute);
    result.set(clientId, {
      metrics: [
        { id: "nextAppointment", value: next === undefined ? null : formatNext(next, input.today) },
        // Последняя тренировка появится вместе с дневником тренировок (T03).
        { id: "lastTraining", value: null },
        { id: "credits", value: credits(input.rules, input.accounting.get(clientId) ?? null, input.today) },
      ],
      restricted: hasRestrictions(input.answers.get(clientId) ?? null),
      todayStartMinute: today?.startMinute ?? null,
      todayEndMinute: today === undefined ? null : today.startMinute + today.durationMinutes,
    });
  }
  return result;
}

function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Источник сводки для экрана «Клиенты». Календарь читается одним диапазоном; учёт и анкета пока
 * по клиенту (у их портов нет пакетного метода) — отказ одного источника даёт «нет данных».
 */
export function createRosterOverviewSource(ports: Readonly<{
  rules: HomeSummaryRules;
  calendar: CalendarRepositoryPort;
  accounting: AccountingRepositoryPort;
  questionnaire: QuestionnaireRepositoryPort;
}>): RosterOverviewPort {
  const safe = <T>(load: () => Promise<T>) => Promise.resolve().then(load).catch(() => null);
  return {
    load: async (clientIds, now) => {
      const today = localDate(now);
      const [range, snapshots, answers] = await Promise.all([
        safe(() => ports.calendar.listRange(today, shiftDate(today, LOOKAHEAD_DAYS))),
        Promise.all(clientIds.map((id) => safe(() => ports.accounting.getClientSnapshot(id)))),
        Promise.all(clientIds.map((id) => safe(() => ports.questionnaire.getAnswers(id)))),
      ]);
      return buildRosterOverview({
        rules: ports.rules, clientIds, appointments: range?.appointments ?? [], today,
        nowMinute: now.getHours() * 60 + now.getMinutes(),
        accounting: new Map(clientIds.map((id, index) => [id, snapshots[index] ?? null])),
        answers: new Map(clientIds.map((id, index) => [id, answers[index]?.answers ?? null])),
      });
    },
    subscribe: (listener) => {
      const offs = [
        ports.calendar.subscribeCommittedChanges(() => listener()),
        ports.accounting.subscribeCommittedChanges(() => listener()),
        ports.questionnaire.subscribeCommittedChanges(() => listener()),
      ];
      return () => { for (const off of offs) off(); };
    },
  };
}
