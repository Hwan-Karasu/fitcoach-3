import type { Appointment, AppointmentInput, AppointmentOutcome, CalendarInterval, CategoryPolicy, SessionTypeInput, CancelSettlement, CalendarSettings, ClearWeekSummary,
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
  /**
   * Reschedule/edit keeps the stable ID. A started (also COMPLETED) record is editable too: time, type and note
   * change, the ledger and the outcome stay; the client changes only via correctClient (CALENDAR_CORRECTION_INVALID),
   * a type that flips «requires credit» is refused (CALENDAR_STARTED_TYPE_CREDIT), a COMPLETED record cannot move
   * into the future (CALENDAR_OUTCOME_TOO_EARLY).
   */
  updateAppointment(id: string, expectedRevision: number, input: AppointmentInput, now?: Date): Promise<Appointment>;
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
  /**
   * Undo of «Отменена» (§48.38.6): back to the outcome it had before (null = no outcome). A started
   * record gets at most one effective USED again, a future one its reservation; fails with
   * CALENDAR_RESTORE_INVALID, CALENDAR_TIME_OVERLAP/BLOCKED_TIME or ACCOUNTING_INSUFFICIENT_CREDIT.
   */
  restoreCancelled(id: string, expectedRevision: number, previousOutcome: "COMPLETED" | "MISSED" | null,
    now?: Date): Promise<Appointment>;
  setUndoCancelPrompt(enabled: boolean): Promise<void>;
  /**
   * §13.5–13.6: display days and the visible day window live in the Calendar header. They are
   * presentation only and never move or delete appointments outside them.
   */
  /** §13.8 management. Fails with CALENDAR_SESSION_TYPE_INVALID or CALENDAR_SESSION_TYPE_CREDIT_LOCKED. */
  createSessionType(input: SessionTypeInput): Promise<SessionType>;
  /** Snapshots of existing appointments stay; requiresCredit is locked once the type is used. */
  updateSessionType(id: string, input: SessionTypeInput): Promise<SessionType>;
  /** Delete an unused non-default template. Referenced types keep their stable identity/history. */
  deleteSessionType(id: string): Promise<void>;
  /** Archive hides the type from new bookings; the default type cannot be archived. */
  setSessionTypeArchived(id: string, archived: boolean): Promise<void>;
  setDefaultSessionType(id: string): Promise<void>;
  /** §13.12 which categories Copy/Paste Week and Clear Week touch. */
  updatePolicies(input: Readonly<{ copyPolicy: CategoryPolicy; clearPolicy: CategoryPolicy }>): Promise<CalendarSettings>;
  /**
   * §13.17 safe defaults: copy/clear policies, default type and the undo prompt. Appointments,
   * intervals, credits, display days and the day window are not touched.
   */
  resetSettings(): Promise<CalendarSettings>;
  updateDisplaySettings(input: Readonly<{ visibleWeekdays: readonly boolean[]; dayStartMinute: number;
    dayEndMinute: number }>): Promise<CalendarSettings>;
  /** Other not cancelled records of the same guest (name match ignores case and spaces). */
  countSameGuest(appointmentId: string): Promise<number>;
  /**
   * A guest without a card becomes a client (§13.7.3 guest/free-name): the record, and optionally every
   * other not cancelled record of that guest, moves to the client. Past visits stay uncharged; a
   * future record of a FITCOACH client gets a reservation or, without credits, «без списания».
   * A null revision links only if the record is still that guest. Returns the number of records.
   */
  linkGuestToClient(appointmentId: string, expectedRevision: number | null, clientId: string,
    includeSameName: boolean, now?: Date): Promise<number>;
  /** Ended appointments (clients and guests) without an outcome, oldest first (§48.40). */
  listPendingOutcomes(now: Date): Promise<readonly Appointment[]>;
  createInterval(input: IntervalInput): Promise<CalendarInterval>;
  removeInterval(id: string): Promise<void>;
  /**
   * Атомарно убрать интервалы и создать новые: ползунок длительности, вырезание куска дежурства.
   * Любая ошибка (CALENDAR_TIME_OVERLAP, CALENDAR_BLOCKED_OVER_APPOINTMENT…) ничего не меняет.
   */
  reshapeIntervals(removeIds: readonly string[], create: readonly IntervalInput[]): Promise<void>;
  copyWeek(monday: LocalDate): Promise<WeekTemplate>;
  /** Existing entities always win; skipped rows are counted, never merged (§13.13). */
  pasteWeek(monday: LocalDate, template: WeekTemplate,
    eligibleClientIds: ReadonlySet<string>): Promise<PasteResult>;
  /** Clear Week touches only rows that have not started; the past keeps its outcomes and credits. */
  previewClearWeek(monday: LocalDate, now?: Date): Promise<ClearWeekSummary>;
  clearWeek(monday: LocalDate, now?: Date): Promise<ClearWeekSummary>;
  subscribeCommittedChanges(listener: (change: CalendarCommittedChange) => void): () => void;
}
