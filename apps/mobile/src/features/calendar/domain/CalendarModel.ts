/** Calendar wall-clock model: a local date plus minutes from local midnight (§13.6). */
export type LocalDate = string;

export const SLOT_MINUTES = 30;
export const DAY_MINUTES = 24 * 60;
export const APPOINTMENT_DURATIONS = [30, 60, 90, 120] as const;

export type AppointmentLifecycle = "SCHEDULED" | "COMPLETED" | "CANCELLED";
export type IntervalKind = "DUTY" | "BLOCKED";
export type SessionTypeCategory = "TRAINING" | "INSTRUCTION" | "CONSULTATION" | "OTHER";

export interface SessionType {
  readonly id: string;
  readonly name: string;
  readonly category: SessionTypeCategory;
  readonly defaultDurationMinutes: number;
  readonly requiresCredit: boolean;
  readonly archived: boolean;
}

export interface Appointment {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly startMinute: number;
  readonly durationMinutes: number;
  /** Null for a guest or after the client was permanently deleted. */
  readonly clientId: string | null;
  readonly guestName: string | null;
  readonly participantDeleted: boolean;
  readonly sessionTypeId: string;
  /** Snapshot taken when the type was chosen; later template edits do not rewrite it. */
  readonly sessionTypeName: string;
  readonly note: string | null;
  readonly lifecycle: AppointmentLifecycle;
  readonly revision: number;
}

export interface CalendarInterval {
  readonly id: string;
  readonly kind: IntervalKind;
  readonly localDate: LocalDate;
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface CategoryPolicy {
  readonly appointments: boolean;
  readonly duty: boolean;
  readonly blocked: boolean;
}

export interface CalendarSettings {
  readonly dayStartMinute: number;
  readonly dayEndMinute: number;
  /** Monday-first display columns; presentation only, never availability (§13.5). */
  readonly visibleWeekdays: readonly boolean[];
  readonly defaultSessionTypeId: string | null;
  readonly copyPolicy: CategoryPolicy;
  readonly clearPolicy: CategoryPolicy;
}

export interface AppointmentInput {
  readonly localDate: LocalDate;
  readonly startMinute: number;
  readonly durationMinutes: number;
  readonly clientId: string | null;
  readonly guestName: string | null;
  readonly sessionTypeId: string;
  readonly note: string | null;
}

export interface IntervalInput {
  readonly kind: IntervalKind;
  readonly localDate: LocalDate;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** Copy Week stores a template of slots, never entity IDs or settlements (§13.15). */
export interface WeekTemplate {
  readonly appointments: readonly Readonly<{
    weekdayIndex: number; startMinute: number; durationMinutes: number;
    clientId: string | null; guestName: string | null; sessionTypeId: string; note: string | null;
  }>[];
  readonly intervals: readonly Readonly<{
    weekdayIndex: number; kind: IntervalKind; startMinute: number; endMinute: number;
  }>[];
}

export interface PasteResult {
  readonly inserted: number;
  readonly skippedBusy: number;
  readonly skippedUnavailable: number;
}

export interface ClearWeekSummary {
  readonly scheduledAppointments: number;
  readonly completedKept: number;
  readonly duty: number;
  readonly blocked: number;
}

export interface DaySummary {
  readonly localDate: LocalDate;
  readonly appointments: number;
}
