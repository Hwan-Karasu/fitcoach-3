import type { AccountingRepositoryPort, ClientAccountingSnapshot } from "../features/accounting/public.ts";
import type { Appointment, CalendarRepositoryPort } from "../features/calendar/public.ts";
import type { RosterClientOverview, RosterMetricValue, RosterOverview, RosterOverviewPort } from "../features/clients/public.ts";
import type { DailyPoint, DailyPrimary, Measurement, MeasurementRepositoryPort, MeasurementType } from "../features/measurements/public.ts";
import type { Nutrients, NutritionCalcPort, NutritionDiaryPort } from "../features/nutrition/public.ts";
import type { TrainingHistoryPort } from "./trainingHistory.ts";
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
  extraMetrics?: ReadonlyMap<string, readonly RosterMetricValue[]>;
  failedHealthClientIds?: ReadonlySet<string>;
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
    const metrics: RosterMetricValue[] = [
        { id: "nextAppointment", value: next === undefined ? null : formatNext(next, input.today) },
        // Последняя тренировка появится вместе с дневником тренировок (T03).
        { id: "lastTraining", value: null },
        { id: "credits", value: credits(input.rules, input.accounting.get(clientId) ?? null, input.today) },
      ];
    for (const metric of input.extraMetrics?.get(clientId) ?? []) {
      const index = metrics.findIndex((item) => item.id === metric.id);
      if (index < 0) metrics.push(metric); else metrics[index] = metric;
    }
    result.set(clientId, {
      metrics,
      restricted: hasRestrictions(input.answers.get(clientId) ?? null),
      restrictionsKnown: !input.failedHealthClientIds?.has(clientId),
      creditStatus: (() => {
        const pack = packSummary(input.rules, input.accounting.get(clientId) ?? null, input.today);
        return pack.kind === "TRACKED" ? (pack.available > 0 ? "AVAILABLE" : "EMPTY")
          : pack.kind === "NO_PACK" ? "NO_PACK" : pack.kind === "NOT_TRACKED" ? "NOT_TRACKED" : "UNKNOWN";
      })(),
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
  measurements?: MeasurementRepositoryPort;
  diary?: NutritionDiaryPort;
  calc?: NutritionCalcPort;
  history?: TrainingHistoryPort;
  onTrainingChange?: (listener: () => void) => () => void;
  latestPoint?: (measurements: readonly Measurement[], primaries: readonly DailyPrimary[], type: MeasurementType) => DailyPoint | null;
  sumNutrients?: (values: readonly Nutrients[]) => Nutrients;
}>): RosterOverviewPort {
  const safe = <T>(load: () => Promise<T>) => Promise.resolve().then(load).catch(() => null);
  return {
    load: async (clientIds, now, metricIds = ["nextAppointment", "lastTraining", "credits"]) => {
      const today = localDate(now);
      const selected = new Set(metricIds);
      const [range, snapshots, answers, extra] = await Promise.all([
        safe(() => ports.calendar.listRange(today, shiftDate(today, LOOKAHEAD_DAYS))),
        Promise.all(clientIds.map((id) => safe(() => ports.accounting.getClientSnapshot(id)))),
        Promise.all(clientIds.map((id) => Promise.resolve().then(() => ports.questionnaire.getAnswers(id))
          .then((value) => ({ value, failed: false }), () => ({ value: null, failed: true })))),
        Promise.all(clientIds.map(async (id): Promise<readonly [string, readonly RosterMetricValue[]]> => {
          const [measurements, entries, steps, history] = await Promise.all([
            (selected.has("weight") || selected.has("fatPercent")) && ports.measurements ? safe(() => ports.measurements!.listForClient(id)) : null,
            selected.has("calories") && ports.diary ? safe(() => ports.diary!.listEatenEntries(id, today, today)) : null,
            selected.has("steps") && ports.calc ? safe(() => ports.calc!.listSteps(id, today, today)) : null,
            selected.has("lastTraining") && ports.history ? safe(() => ports.history!.list(id)) : null,
          ]);
          const metrics: RosterMetricValue[] = [];
          for (const [metricId, type, unit] of [["weight", "WEIGHT", "кг"], ["fatPercent", "BODY_FAT", "%"]] as const) {
            if (!selected.has(metricId)) continue;
            const point = measurements && ports.latestPoint ? ports.latestPoint(measurements.measurements.filter((row) => row.localDate <= today), measurements.primaries, type) : null;
            metrics.push({ id: metricId, value: point?.kind === "VALUE" ? `${String(point.measurement.valueX10 / 10).replace(".", ",")} ${unit}` : null });
          }
          if (selected.has("calories")) {
            const total = entries && entries.length > 0 ? ports.sumNutrients?.(entries.map((row) => row.snapshot.eaten)).kcalX10 : null;
            metrics.push({ id: "calories", value: total === null || total === undefined ? null : `${Math.round(total / 10)} ккал` });
          }
          if (selected.has("steps")) metrics.push({ id: "steps", value: steps?.[0] ? String(steps[0].steps) : null });
          if (selected.has("lastTraining") && ports.history) {
            const last = history?.filter((row) => row.status === "COMPLETED" && row.actualDate !== null && row.actualDate <= today)
              .map((row) => row.actualDate!).sort().at(-1);
            metrics.push({ id: "lastTraining", value: last ? `${last.slice(8, 10)}.${last.slice(5, 7)}` : null });
          }
          return [id, metrics];
        })),
      ]);
      return buildRosterOverview({
        rules: ports.rules, clientIds, appointments: range?.appointments ?? [], today,
        nowMinute: now.getHours() * 60 + now.getMinutes(),
        accounting: new Map(clientIds.map((id, index) => [id, snapshots[index] ?? null])),
        answers: new Map(clientIds.map((id, index) => [id, answers[index]?.value?.answers ?? null])),
        failedHealthClientIds: new Set(clientIds.filter((_, index) => answers[index]?.failed === true)),
        extraMetrics: new Map(extra),
      });
    },
    subscribe: (listener) => {
      const offs = [
        ports.calendar.subscribeCommittedChanges(() => listener()),
        ports.accounting.subscribeCommittedChanges(() => listener()),
        ports.questionnaire.subscribeCommittedChanges(() => listener()),
      ];
      if (ports.measurements) offs.push(ports.measurements.subscribeCommittedChanges(() => listener()));
      if (ports.diary) offs.push(ports.diary.subscribeCommittedChanges(() => listener()));
      if (ports.calc) offs.push(ports.calc.subscribeCommittedChanges(() => listener()));
      if (ports.onTrainingChange) offs.push(ports.onTrainingChange(listener));
      return () => { for (const off of offs) off(); };
    },
  };
}
