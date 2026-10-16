/** Calendar wall-clock model: a local date plus minutes from local midnight (§13.6). */
export type LocalDate = string;

export const SLOT_MINUTES = 30;
export const DAY_MINUTES = 24 * 60;
export const APPOINTMENT_DURATIONS = [30, 60, 90, 120] as const;

/** COMPLETED is a closed record with a chosen outcome (Завершена or Пропущена), never inferred from USED. */
export type AppointmentLifecycle = "SCHEDULED" | "COMPLETED" | "CANCELLED";
/**
 * Factual outcome chosen by the trainer (§48.35). Null on a SCHEDULED row: after its end time that
 * is «Ожидает решения»; elapsed time and credit settlement never set it.
 */
export type AppointmentOutcome = "COMPLETED" | "MISSED" | "CANCELLED";
export type IntervalKind = "DUTY" | "BLOCKED";
export type SessionTypeCategory = "TRAINING" | "INSTRUCTION" | "CONSULTATION" | "OTHER";

/** Presentation-only palette keys (§13.16); null follows the theme accent. Never business logic. */
export const SESSION_TYPE_COLORS = ["teal", "blue", "violet", "amber", "rose", "slate"] as const;
export type SessionTypeColor = typeof SESSION_TYPE_COLORS[number];

export interface SessionType {
  readonly id: string;
  readonly name: string;
  readonly category: SessionTypeCategory;
  readonly defaultDurationMinutes: number;
  readonly requiresCredit: boolean;
  readonly archived: boolean;
  readonly color: SessionTypeColor | null;
  /** Used by at least one appointment: its credit semantics are locked (§13.8 Mutability). */
  readonly inUse: boolean;
}

export interface SessionTypeInput {
  readonly name: string;
  readonly category: SessionTypeCategory;
  readonly defaultDurationMinutes: number;
  readonly requiresCredit: boolean;
  readonly color: SessionTypeColor | null;
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
  /** «Записать без списания» (§22.1.4): never reserves or uses a credit. */
  readonly creditBypass: boolean;
  readonly lifecycle: AppointmentLifecycle;
  readonly outcome: AppointmentOutcome | null;
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
  /** Offer «Вернуть» for 3 seconds after «Отменена»; «Больше не спрашивать» turns it off. */
  readonly undoCancelPrompt: boolean;
}

export interface AppointmentInput {
  readonly localDate: LocalDate;
  readonly startMinute: number;
  readonly durationMinutes: number;
  readonly clientId: string | null;
  readonly guestName: string | null;
  readonly sessionTypeId: string;
  readonly note: string | null;
  readonly creditBypass?: boolean;
}

/** «Создать карточку клиента» from a guest record: which records follow the new client. */
export interface GuestLinkRequest {
  readonly appointmentId: string;
  readonly guestName: string;
  readonly includeSameName: boolean;
}

/** What to do with credits when a client appointment leaves the active schedule (§22.1.4). */
export type CancelSettlement = "RETURN" | "CHARGE";

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
  /** Started, ended or closed appointments that Clear Week leaves untouched. */
  readonly pastKept: number;
  readonly duty: number;
  readonly blocked: number;
}

export interface DaySummary {
  readonly localDate: LocalDate;
  readonly appointments: number;
}
