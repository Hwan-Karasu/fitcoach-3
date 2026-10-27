import { DAY_MINUTES, SESSION_TYPE_COLORS, SLOT_MINUTES, type Appointment, type AppointmentInput,
  type CalendarInterval, type CalendarSettings, type IntervalInput, type LocalDate, type SessionTypeInput,
  type WeekTemplate } from "./CalendarModel.ts";

export type CalendarRuleError =
  | "CALENDAR_DATE_INVALID"
  | "CALENDAR_TIME_INVALID"
  | "CALENDAR_OUTSIDE_DAY_RANGE"
  | "CALENDAR_PARTICIPANT_REQUIRED"
  | "CALENDAR_SESSION_TYPE_REQUIRED"
  | "CALENDAR_SETTINGS_INVALID"
  | "CALENDAR_SESSION_TYPE_INVALID";

function fail(code: CalendarRuleError): never { throw new Error(code); }

function utcEpoch(date: LocalDate): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  if (year < 1) return null;
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day ? value.getTime() : null;
}

export function isLocalDate(date: string): boolean { return utcEpoch(date) !== null; }

/** Pure calendar arithmetic in UTC, so DST transitions cannot shift a wall-clock day. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const epoch = utcEpoch(date) ?? fail("CALENDAR_DATE_INVALID");
  const value = new Date(epoch + days * 86_400_000);
  return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: LocalDate): number {
  const epoch = utcEpoch(date) ?? fail("CALENDAR_DATE_INVALID");
  return (new Date(epoch).getUTCDay() + 6) % 7;
}

export function mondayOf(date: LocalDate): LocalDate { return addDays(date, -weekdayIndex(date)); }

export function weekDates(monday: LocalDate): readonly LocalDate[] {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** First and last date of the month grid month, not the 6-row viewport. */
export function monthRange(anyDate: LocalDate): Readonly<{ first: LocalDate; last: LocalDate }> {
  if (!isLocalDate(anyDate)) fail("CALENDAR_DATE_INVALID");
  const first = `${anyDate.slice(0, 7)}-01`;
  const [year, month] = first.split("-").map(Number) as [number, number];
  const nextFirst = month === 12 ? `${String(year + 1).padStart(4, "0")}-01-01`
    : `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
  return { first, last: addDays(nextFirst, -1) };
}

export function localDateOf(at: Date): LocalDate {
  return `${String(at.getFullYear()).padStart(4, "0")}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

export function minuteOfDay(at: Date): number { return at.getHours() * 60 + at.getMinutes(); }

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function onSlot(minute: number): boolean {
  return Number.isSafeInteger(minute) && minute % SLOT_MINUTES === 0;
}

/** Half-open intervals: 10:00–11:00 and 11:00–12:00 do not overlap. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function validateSettings(settings: CalendarSettings): void {
  if (!onSlot(settings.dayStartMinute) || !onSlot(settings.dayEndMinute)
    || settings.dayStartMinute < 0 || settings.dayEndMinute > DAY_MINUTES
    || settings.dayEndMinute - settings.dayStartMinute < SLOT_MINUTES
    || settings.visibleWeekdays.length !== 7 || !settings.visibleWeekdays.some(Boolean)) {
    fail("CALENDAR_SETTINGS_INVALID");
  }
}

/** Normalized appointment input; the planner window bounds new bookings (§13.6). */
export function validateAppointment(input: AppointmentInput, settings: CalendarSettings,
  enforceDayRange: boolean): AppointmentInput {
  if (!isLocalDate(input.localDate)) fail("CALENDAR_DATE_INVALID");
  if (!onSlot(input.startMinute) || !onSlot(input.durationMinutes) || input.durationMinutes <= 0
    || input.startMinute < 0 || input.startMinute + input.durationMinutes > DAY_MINUTES) {
    fail("CALENDAR_TIME_INVALID");
  }
  if (enforceDayRange && (input.startMinute < settings.dayStartMinute
    || input.startMinute + input.durationMinutes > settings.dayEndMinute)) {
    fail("CALENDAR_OUTSIDE_DAY_RANGE");
  }
  const clientId = input.clientId?.trim() || null;
  const guestName = clientId === null ? input.guestName?.trim() || null : null;
  if (clientId === null && guestName === null) fail("CALENDAR_PARTICIPANT_REQUIRED");
  if (guestName !== null && guestName.length > 120) fail("CALENDAR_PARTICIPANT_REQUIRED");
  if (!input.sessionTypeId.trim()) fail("CALENDAR_SESSION_TYPE_REQUIRED");
  const note = input.note?.trim() || null;
  if (note !== null && note.length > 1000) fail("CALENDAR_TIME_INVALID");
  return { ...input, clientId, guestName, note };
}

/** §13.8: a named reusable template; duration is a default on the 30-minute grid. */
export function validateSessionType(input: SessionTypeInput): SessionTypeInput {
  const name = input.name.trim().replace(/\s+/gu, " ");
  if (!name || name.length > 60 || !["TRAINING", "INSTRUCTION", "CONSULTATION", "OTHER"].includes(input.category)
    || !onSlot(input.defaultDurationMinutes) || input.defaultDurationMinutes < SLOT_MINUTES
    || input.defaultDurationMinutes > 240
    || (input.color !== null && !(SESSION_TYPE_COLORS as readonly string[]).includes(input.color))) {
    fail("CALENDAR_SESSION_TYPE_INVALID");
  }
  return { ...input, name };
}

export function validateInterval(input: IntervalInput): IntervalInput {
  if (!isLocalDate(input.localDate)) fail("CALENDAR_DATE_INVALID");
  if ((input.kind !== "DUTY" && input.kind !== "BLOCKED") || !onSlot(input.startMinute)
    || !onSlot(input.endMinute) || input.startMinute < 0 || input.endMinute > DAY_MINUTES
    || input.endMinute <= input.startMinute) fail("CALENDAR_TIME_INVALID");
  return input;
}

type Timed = Pick<Appointment, "localDate" | "startMinute" | "durationMinutes">;

/** Wall-clock comparison: the local date and minute of `now` against the appointment slot. */
function reached(localDate: LocalDate, minute: number, now: Date): boolean {
  const today = localDateOf(now);
  return localDate < today || (localDate === today && minute <= minuteOfDay(now));
}

export function appointmentStarted(row: Timed, now: Date): boolean {
  return reached(row.localDate, row.startMinute, now);
}

export function appointmentEnded(row: Timed, now: Date): boolean {
  return reached(row.localDate, row.startMinute + row.durationMinutes, now);
}

/**
 * «Ожидает решения» (§48.35): an ended appointment without a chosen outcome, for a client or a guest
 * without a card; records of a permanently deleted client are not asked about.
 */
export function isPendingOutcome(row: Appointment, now: Date): boolean {
  return row.lifecycle === "SCHEDULED" && !row.participantDeleted && appointmentEnded(row, now);
}

/** Guest names match case- and space-insensitively: «Анна  К» and «анна к» are one guest. */
export function sameGuestName(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru");
  return normalize(a) === normalize(b);
}

export function isOccupying(appointment: Appointment): boolean {
  return appointment.lifecycle !== "CANCELLED";
}

/** Template from one week; cancelled and anonymized rows never enter it (§13.15). */
export function buildWeekTemplate(monday: LocalDate, appointments: readonly Appointment[],
  intervals: readonly CalendarInterval[], policy: CalendarSettings["copyPolicy"]): WeekTemplate {
  const dates = weekDates(monday);
  const indexOf = (date: LocalDate) => dates.indexOf(date);
  return {
    appointments: policy.appointments ? appointments
      .filter((row) => isOccupying(row) && !row.participantDeleted && indexOf(row.localDate) >= 0)
      .map((row) => ({ weekdayIndex: indexOf(row.localDate), startMinute: row.startMinute,
        durationMinutes: row.durationMinutes, clientId: row.clientId, guestName: row.guestName,
        sessionTypeId: row.sessionTypeId, note: row.note })) : [],
    intervals: intervals.filter((row) => indexOf(row.localDate) >= 0
      && (row.kind === "DUTY" ? policy.duty : policy.blocked))
      .map((row) => ({ weekdayIndex: indexOf(row.localDate), kind: row.kind,
        startMinute: row.startMinute, endMinute: row.endMinute })),
  };
}

export function templateSize(template: WeekTemplate): number {
  return template.appointments.length + template.intervals.length;
}

export function appointmentLabel(row: Pick<Appointment, "guestName" | "participantDeleted">,
  clientName: string | null): string {
  if (row.participantDeleted) return "Удалённый клиент";
  return clientName ?? row.guestName ?? "Клиент";
}
