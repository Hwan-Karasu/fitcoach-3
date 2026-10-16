import { useEffect, useRef, useState } from "react";
import type { Appointment, CalendarInterval, CalendarSettings, LocalDate, SessionTypeColor } from "../domain/CalendarModel.ts";
import type { CalendarParticipant, CalendarParticipantDirectoryPort } from
  "../domain/CalendarParticipantDirectoryPort.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { addDays, isPendingOutcome, monthRange, weekdayIndex } from "../domain/CalendarRules.ts";

export const weekdayShort = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const weekdayLong = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота",
  "воскресенье"] as const;
const monthGenitive = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
  "сентября", "октября", "ноября", "декабря"] as const;
const monthNominative = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август",
  "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;

export function dayTitle(date: LocalDate): string {
  return `${weekdayLong[weekdayIndex(date)]}, ${Number(date.slice(8, 10))} ${monthGenitive[Number(date.slice(5, 7)) - 1]}`;
}

export function monthTitle(date: LocalDate): string {
  return `${monthNominative[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** Dark enough for white text in light and dark themes; colour is never the only marker (§13.16). */
export const sessionTypeColorHex: Readonly<Record<SessionTypeColor, string>> = {
  teal: "#0E6E73", blue: "#2456A6", violet: "#6A3FA0", amber: "#8A5A00", rose: "#A3324F", slate: "#4A5563",
};

/** Session type id → block colour for the timeline; types without a colour follow the theme accent. */
export function useSessionTypeColors(repository: CalendarRepositoryPort): ReadonlyMap<string, string> {
  const [map, setMap] = useState<ReadonlyMap<string, string>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void repository.listSessionTypes().then((types) => {
      if (active) {
        setMap(new Map(types.flatMap((type) => (type.color === null ? [] : [[type.id, sessionTypeColorHex[type.color]] as const]))));
      }
    }, () => undefined);
    return () => { active = false; };
  }, [repository, tick]);
  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.dates === "ALL") setTick((value) => value + 1);
  }), [repository]);
  return map;
}

export function calendarErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "CALENDAR_TIME_OVERLAP": return "Это время уже занято другой записью или интервалом того же типа.";
    case "CALENDAR_BLOCKED_TIME": return "Время заблокировано. Сначала снимите блокировку или выберите другое время.";
    case "CALENDAR_BLOCKED_OVER_APPOINTMENT": return "Нельзя заблокировать время поверх записи. Запись не изменена.";
    case "CALENDAR_OUTSIDE_DAY_RANGE": return "Запись должна помещаться в рабочее окно календаря.";
    case "CALENDAR_PARTICIPANT_REQUIRED": return "Выберите клиента или укажите имя гостя.";
    case "CALENDAR_SESSION_TYPE_REQUIRED":
    case "CALENDAR_SESSION_TYPE_UNAVAILABLE": return "Выберите доступный тип занятия.";
    case "CALENDAR_STALE_APPOINTMENT": return "Запись уже изменилась. Откройте её заново.";
    case "CALENDAR_TIME_INVALID": return "Проверьте время: шаг — 30 минут, запись не переходит через полночь.";
    case "ACCOUNTING_INSUFFICIENT_CREDIT":
      return "У клиента нет доступных тренировок. Добавьте пакет или включите «Записать без списания».";
    case "CALENDAR_SESSION_TYPE_INVALID": return "Проверьте тип: название до 60 символов, длительность от 30 до 240 минут с шагом 30.";
    case "CALENDAR_SESSION_TYPE_CREDIT_LOCKED": return "Тип уже используется в записях: списание не меняется задним числом. Создайте новый тип.";
    case "CALENDAR_DEFAULT_TYPE_ARCHIVE": return "Сначала выберите другой тип по умолчанию, затем убирайте этот в архив.";
    case "CALENDAR_GUEST_LINK_INVALID": return "Запись уже не гостевая или отменена.";
    case "CALENDAR_RESTORE_INVALID": return "Эту запись уже нельзя вернуть.";
    case "CALENDAR_OUTCOME_TOO_EARLY": return "Занятие ещё не началось. Исход можно отметить после начала.";
    case "CALENDAR_CORRECTION_INVALID": return "Выберите другого клиента: исправление доступно только для начавшейся записи.";
    case "ACCOUNTING_ALREADY_SETTLED":
      return "Тренировка по записи уже списана: клиента, тип и учёт здесь изменить нельзя.";
    default: return "Не удалось сохранить. Данные календаря не изменены.";
  }
}

/** Calendar-side outcome label; never derived from a USED credit (§48.35). */
export function outcomeTag(row: Appointment, now: Date): Readonly<{ kind: "success" | "warning" | "action_required"; label: string }> | null {
  if (row.outcome === "COMPLETED") return { kind: "success", label: "Проведена" };
  if (row.outcome === "MISSED") return { kind: "warning", label: "Пропущена" };
  return isPendingOutcome(row, now) ? { kind: "action_required", label: "Ожидает решения" } : null;
}

export interface CalendarWeekData {
  readonly settings: CalendarSettings;
  readonly appointments: readonly Appointment[];
  readonly intervals: readonly CalendarInterval[];
  readonly monthCount: number;
}

/**
 * Scoped week + month counter snapshot: keeps the last valid data during refresh and reloads only
 * when a committed change touches the visible week or month (§13.21).
 */
export function useCalendarWeek(repository: CalendarRepositoryPort, monday: LocalDate,
  anchor: LocalDate): Readonly<{ data: CalendarWeekData | null; failed: boolean; retry: () => void }> {
  const [data, setData] = useState<CalendarWeekData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const month = monthRange(anchor);
  const sunday = addDays(monday, 6);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    void Promise.all([
      repository.getSettings(), repository.listRange(monday, sunday),
      repository.summarize(month.first, month.last),
    ]).then(([settings, range, summary]) => {
      if (request !== generation.current) return;
      setData({ settings, appointments: range.appointments, intervals: range.intervals,
        monthCount: summary.reduce((sum, day) => sum + day.appointments, 0) });
      setFailed(false);
    }, () => { if (request === generation.current) setFailed(true); });
  }, [repository, monday, sunday, month.first, month.last, tick]);

  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.dates === "ALL" || change.dates.some((date) =>
      (date >= monday && date <= sunday) || (date >= month.first && date <= month.last))) {
      setTick((value) => value + 1);
    }
  }), [repository, monday, sunday, month.first, month.last]);

  return { data, failed, retry: () => setTick((value) => value + 1) };
}

/** Appointment counts per date of the visible month grid (§13.2 indicator); keeps old counts on refresh. */
export function useMonthCounts(repository: CalendarRepositoryPort, first: LocalDate,
  last: LocalDate): ReadonlyMap<LocalDate, number> {
  const [counts, setCounts] = useState<ReadonlyMap<LocalDate, number>>(new Map());
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    void repository.summarize(first, last).then((rows) => {
      if (request === generation.current) setCounts(new Map(rows.map((row) => [row.localDate, row.appointments])));
    }, () => undefined);
  }, [repository, first, last, tick]);
  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.dates === "ALL" || change.dates.some((date) => date >= first && date <= last)) {
      setTick((value) => value + 1);
    }
  }), [repository, first, last]);
  return counts;
}

export function useParticipants(directory: CalendarParticipantDirectoryPort):
  ReadonlyMap<string, CalendarParticipant> {
  const [map, setMap] = useState<ReadonlyMap<string, CalendarParticipant>>(new Map());
  useEffect(() => {
    let active = true;
    const load = () => {
      void directory.listParticipants().then((rows) => {
        if (active) setMap(new Map(rows.map((row) => [row.id, row])));
      }, () => undefined);
    };
    load();
    const unsubscribe = directory.subscribe(load);
    return () => { active = false; unsubscribe(); };
  }, [directory]);
  return map;
}
