import type { Appointment, AppointmentInput, AppointmentOutcome, CalendarInterval, CancelSettlement, CalendarSettings, ClearWeekSummary,
  DaySummary, IntervalInput, LocalDate, PasteResult, SessionType, WeekTemplate } from "./CalendarModel.ts";

/** UI invalidation hint emitted only after commit; SQLite rows stay authoritative. */
export interface CalendarCommittedChange {
  readonly dates: readonly LocalDate[] | "ALL";
}

/**
 * Commands fail with typed codes: CALENDAR_TIME_OVERLAP, CALENDAR_BLOCKED_TIME,
 * CALENDAR_SESSION_TYPE_UNAVAILABLE, CALENDAR_STALE_APPOINTMENT and CalendarRuleError.
 */
export interface CalendarRepositoryPort {
  getSettings(): Promise<CalendarSettings>;
  listSessionTypes(): Promise<readonly SessionType[]>;
  /** Appointments that occupy time (SCHEDULED, COMPLETED) and intervals in [from, to]. */
  listRange(from: LocalDate, to: LocalDate): Promise<Readonly<{
    appointments: readonly Appointment[]; intervals: readonly CalendarInterval[];
  }>>;
  /** SCHEDULED + COMPLETED per date; never Duty/Blocked or cancelled rows (§13.19). */
  summarize(from: LocalDate, to: LocalDate): Promise<readonly DaySummary[]>;
  getAppointment(id: string): Promise<Appointment | null>;
  createAppointment(input: AppointmentInput): Promise<Appointment>;
  /** Reschedule/edit of a SCHEDULED appointment keeps its stable ID. */
  updateAppointment(id: string, expectedRevision: number, input: AppointmentInput): Promise<Appointment>;
  /**
   * Removes a SCHEDULED appointment from the active schedule; the settlement returns the credit
   * to the client or charges it. Ignored when no credit is involved.
   */
  cancelAppointment(id: string, expectedRevision: number, settlement?: CancelSettlement): Promise<void>;
  /**
   * ResolveAppointmentOutcome (§48.35/48.38). COMPLETED/MISSED need a started appointment and keep
   * exactly one USED; CANCELLED leaves the active schedule and returns the credit. Switching between
   * COMPLETED and MISSED never touches the ledger. Fails with CALENDAR_OUTCOME_TOO_EARLY or
   * CALENDAR_STALE_APPOINTMENT.
   */
  resolveOutcome(id: string, expectedRevision: number, outcome: AppointmentOutcome, now?: Date): Promise<Appointment>;
  /** «Отменить завершение/пропуск»: back to pending; an already charged USED stays (§48.38.4). */
  clearOutcome(id: string, expectedRevision: number): Promise<Appointment>;
  /**
   * CorrectCompletedAppointmentClient (§22.1.4): only for a started, not cancelled client record.
   * The old client's USED is compensated by RETURNED and the new client is charged in the same
   * transaction; fails with CALENDAR_CORRECTION_INVALID or ACCOUNTING_INSUFFICIENT_CREDIT.
   */
  correctClient(id: string, expectedRevision: number, clientId: string, now?: Date): Promise<Appointment>;
  /** Ended client appointments without an outcome, oldest first (§48.40). */
  listPendingOutcomes(now: Date): Promise<readonly Appointment[]>;
  createInterval(input: IntervalInput): Promise<CalendarInterval>;
  removeInterval(id: string): Promise<void>;
  copyWeek(monday: LocalDate): Promise<WeekTemplate>;
  /** Existing entities always win; skipped rows are counted, never merged (§13.13). */
  pasteWeek(monday: LocalDate, template: WeekTemplate,
    eligibleClientIds: ReadonlySet<string>): Promise<PasteResult>;
  /** Clear Week touches only rows that have not started; the past keeps its outcomes and credits. */
  previewClearWeek(monday: LocalDate, now?: Date): Promise<ClearWeekSummary>;
  clearWeek(monday: LocalDate, now?: Date): Promise<ClearWeekSummary>;
  subscribeCommittedChanges(listener: (change: CalendarCommittedChange) => void): () => void;
}
