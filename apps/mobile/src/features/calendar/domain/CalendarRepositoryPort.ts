import type { Appointment, AppointmentInput, CalendarInterval, CancelSettlement, CalendarSettings, ClearWeekSummary,
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
  createInterval(input: IntervalInput): Promise<CalendarInterval>;
  removeInterval(id: string): Promise<void>;
  copyWeek(monday: LocalDate): Promise<WeekTemplate>;
  /** Existing entities always win; skipped rows are counted, never merged (§13.13). */
  pasteWeek(monday: LocalDate, template: WeekTemplate,
    eligibleClientIds: ReadonlySet<string>): Promise<PasteResult>;
  previewClearWeek(monday: LocalDate): Promise<ClearWeekSummary>;
  clearWeek(monday: LocalDate): Promise<ClearWeekSummary>;
  subscribeCommittedChanges(listener: (change: CalendarCommittedChange) => void): () => void;
}
