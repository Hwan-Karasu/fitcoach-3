import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { Appointment, AppointmentInput, AppointmentOutcome, CalendarInterval, CategoryPolicy, SessionTypeInput, CalendarSettings, CancelSettlement, ClearWeekSummary,
  DaySummary, IntervalInput, LocalDate, PasteResult, SessionType, SessionTypeCategory,
  WeekTemplate } from "../domain/CalendarModel.ts";
import type { CalendarCommittedChange, CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { addDays, appointmentEnded, appointmentStarted, buildWeekTemplate, sameGuestName, validateSessionType, isLocalDate, localDateOf, minuteOfDay, validateAppointment,
  validateInterval, validateSettings, weekDates } from "../domain/CalendarRules.ts";
import type { DevAppointmentAccountingHook, DevBooking } from "./DevAppointmentAccountingHook.ts";
import { DEV_CALENDAR_LEDGER, devCalendarCatalog } from "./DevCalendarCatalog.ts";

interface AppointmentRow {
  id: string; localDate: string; startMinute: number; durationMinutes: number;
  clientId: string | null; guestName: string | null; participantDeleted: number;
  sessionTypeId: string; sessionTypeName: string; note: string | null; creditBypass: number;
  requiresCredit: number; lifecycle: Appointment["lifecycle"]; outcome: Appointment["outcome"]; revision: number;
}

interface SessionTypeRow {
  id: string; name: string; category: SessionTypeCategory; defaultDurationMinutes: number;
  requiresCredit: number; archivedAt: string | null; color: SessionType["color"]; inUse: number;
}

interface SettingsRow {
  day_start_minute: number; day_end_minute: number; visible_weekdays: string;
  default_session_type_id: string | null;
  copy_appointments: number; copy_duty: number; copy_blocked: number;
  clear_appointments: number; clear_duty: number; clear_blocked: number; undo_cancel_prompt: number;
}

const appointmentColumns = `id, local_date AS localDate, start_minute AS startMinute,
  duration_minutes AS durationMinutes, client_id AS clientId, guest_name AS guestName,
  participant_deleted AS participantDeleted, session_type_id AS sessionTypeId,
  session_type_name AS sessionTypeName, note, credit_bypass AS creditBypass,
  session_type_requires_credit AS requiresCredit, lifecycle, outcome, revision`;

const intervalColumns = `id, kind, local_date AS localDate, start_minute AS startMinute,
  end_minute AS endMinute`;

const sessionTypeColumns = `id, name, category, default_duration_minutes AS defaultDurationMinutes,
  requires_credit AS requiresCredit, archived_at AS archivedAt, color,
  EXISTS (SELECT 1 FROM calendar_appointments AS used WHERE used.session_type_id = session_types.id) AS inUse`;

/** Seed templates of §13.8; trainers may later rename or archive them. */
const seedSessionTypes = [
  { key: "personal", name: "Персональная тренировка", category: "TRAINING", minutes: 60, credit: 1 },
  { key: "instruction", name: "Первичный инструктаж", category: "INSTRUCTION", minutes: 60, credit: 0 },
  { key: "consultation", name: "Консультация", category: "CONSULTATION", minutes: 60, credit: 0 },
  { key: "guest", name: "Гостевой визит", category: "OTHER", minutes: 60, credit: 0 },
] as const;

function toAppointment(row: AppointmentRow): Appointment {
  return { id: row.id, localDate: row.localDate, startMinute: row.startMinute,
    durationMinutes: row.durationMinutes, clientId: row.clientId, guestName: row.guestName,
    participantDeleted: row.participantDeleted === 1, sessionTypeId: row.sessionTypeId,
    sessionTypeName: row.sessionTypeName, note: row.note, creditBypass: row.creditBypass === 1,
    lifecycle: row.lifecycle, outcome: row.outcome, revision: row.revision };
}

function booking(input: AppointmentInput, requiresCredit: boolean): DevBooking {
  return { clientId: input.clientId, sessionTypeId: input.sessionTypeId, requiresCredit,
    bypass: input.creditBypass === true, localDate: input.localDate,
    endMinute: input.startMinute + input.durationMinutes };
}

function toSessionType(row: SessionTypeRow): SessionType {
  return { id: row.id, name: row.name, category: row.category,
    defaultDurationMinutes: row.defaultDurationMinutes, requiresCredit: row.requiresCredit === 1,
    archived: row.archivedAt !== null, color: row.color, inUse: row.inUse === 1 };
}

function toSettings(row: SettingsRow): CalendarSettings {
  return {
    dayStartMinute: row.day_start_minute,
    dayEndMinute: row.day_end_minute,
    visibleWeekdays: Array.from(row.visible_weekdays, (flag) => flag === "1"),
    defaultSessionTypeId: row.default_session_type_id,
    copyPolicy: { appointments: row.copy_appointments === 1, duty: row.copy_duty === 1,
      blocked: row.copy_blocked === 1 },
    clearPolicy: { appointments: row.clear_appointments === 1, duty: row.clear_duty === 1,
      blocked: row.clear_blocked === 1 },
    undoCancelPrompt: row.undo_cancel_prompt === 1,
  };
}

async function newId(tx: SqliteStatementPort): Promise<string> {
  const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
  if (!id) throw new Error("CALENDAR_ID_UNAVAILABLE");
  return id;
}

async function activeSessionType(tx: SqliteStatementPort, workspaceId: string,
  id: string): Promise<SessionTypeRow | null> {
  return tx.first<SessionTypeRow>(`SELECT ${sessionTypeColumns} FROM session_types
    WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`, [workspaceId, id]);
}

async function appointmentConflict(tx: SqliteStatementPort, workspaceId: string, date: LocalDate,
  start: number, end: number, exceptId: string | null): Promise<"CALENDAR_TIME_OVERLAP" | "CALENDAR_BLOCKED_TIME" | null> {
  const busy = await tx.first<{ id: string }>(`SELECT id FROM calendar_appointments
    WHERE workspace_id = ? AND local_date = ? AND lifecycle <> 'CANCELLED' AND id IS NOT ?
      AND start_minute < ? AND start_minute + duration_minutes > ? LIMIT 1`,
  [workspaceId, date, exceptId, end, start]);
  if (busy !== null) return "CALENDAR_TIME_OVERLAP";
  const blocked = await tx.first<{ id: string }>(`SELECT id FROM calendar_intervals
    WHERE workspace_id = ? AND local_date = ? AND kind = 'BLOCKED'
      AND start_minute < ? AND end_minute > ? LIMIT 1`, [workspaceId, date, end, start]);
  return blocked === null ? null : "CALENDAR_BLOCKED_TIME";
}

async function intervalConflict(tx: SqliteStatementPort, workspaceId: string,
  input: IntervalInput): Promise<"CALENDAR_TIME_OVERLAP" | "CALENDAR_BLOCKED_OVER_APPOINTMENT" | null> {
  const sameKind = await tx.first<{ id: string }>(`SELECT id FROM calendar_intervals
    WHERE workspace_id = ? AND local_date = ? AND kind = ? AND start_minute < ? AND end_minute > ?
    LIMIT 1`, [workspaceId, input.localDate, input.kind, input.endMinute, input.startMinute]);
  if (sameKind !== null) return "CALENDAR_TIME_OVERLAP";
  if (input.kind === "DUTY") return null;
  const appointment = await tx.first<{ id: string }>(`SELECT id FROM calendar_appointments
    WHERE workspace_id = ? AND local_date = ? AND lifecycle <> 'CANCELLED'
      AND start_minute < ? AND start_minute + duration_minutes > ? LIMIT 1`,
  [workspaceId, input.localDate, input.endMinute, input.startMinute]);
  return appointment === null ? null : "CALENDAR_BLOCKED_OVER_APPOINTMENT";
}

async function insertAppointment(tx: SqliteStatementPort, workspaceId: string,
  input: AppointmentInput, type: SessionTypeRow): Promise<string> {
  const id = await newId(tx);
  const now = new Date().toISOString();
  await tx.run(`INSERT INTO calendar_appointments
    (id, workspace_id, local_date, start_minute, duration_minutes, client_id, guest_name,
     participant_deleted, session_type_id, session_type_name, session_type_category,
     session_type_requires_credit, note, credit_bypass, lifecycle, revision, created_at, updated_at,
     cancelled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'SCHEDULED', 1, ?, ?, NULL)`,
  [id, workspaceId, input.localDate, input.startMinute, input.durationMinutes, input.clientId,
    input.guestName, type.id, type.name, type.category, type.requiresCredit, input.note,
    input.creditBypass === true ? 1 : 0, now, now]);
  return id;
}

async function insertInterval(tx: SqliteStatementPort, workspaceId: string,
  input: IntervalInput): Promise<string> {
  const id = await newId(tx);
  await tx.run(`INSERT INTO calendar_intervals
    (id, workspace_id, kind, local_date, start_minute, end_minute, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [id, workspaceId, input.kind, input.localDate, input.startMinute, input.endMinute,
    new Date().toISOString()]);
  return id;
}

/** Rows that have not started yet; Clear Week never rewrites the past (its outcomes and credits). */
const NOT_STARTED_SQL = "(local_date > ? OR (local_date = ? AND start_minute > ?))";

function notStartedParams(now: Date): readonly [string, string, number] {
  const today = localDateOf(now);
  return [today, today, minuteOfDay(now)];
}

async function countClearWeek(tx: SqliteStatementPort, workspaceId: string, monday: LocalDate,
  settings: CalendarSettings, now: Date): Promise<ClearWeekSummary> {
  const sunday = addDays(monday, 6);
  const appointments = await tx.first<{ future: number | null; total: number }>(`SELECT
      sum(lifecycle = 'SCHEDULED' AND ${NOT_STARTED_SQL}) AS future, count(*) AS total
    FROM calendar_appointments WHERE workspace_id = ? AND local_date BETWEEN ? AND ?
      AND lifecycle <> 'CANCELLED'`, [...notStartedParams(now), workspaceId, monday, sunday]);
  const intervals = await tx.all<{ kind: string; n: number }>(`SELECT kind, count(*) AS n
    FROM calendar_intervals WHERE workspace_id = ? AND local_date BETWEEN ? AND ?
      AND ${NOT_STARTED_SQL} GROUP BY kind`, [workspaceId, monday, sunday, ...notStartedParams(now)]);
  const policy = settings.clearPolicy;
  const cleared = policy.appointments ? appointments?.future ?? 0 : 0;
  return {
    scheduledAppointments: cleared,
    pastKept: (appointments?.total ?? 0) - cleared,
    duty: policy.duty ? intervals.find((row) => row.kind === "DUTY")?.n ?? 0 : 0,
    blocked: policy.blocked ? intervals.find((row) => row.kind === "BLOCKED")?.n ?? 0 : 0,
  };
}

/**
 * Calendar side of PermanentlyDeleteArchivedClient (§15.8): future SCHEDULED rows are cancelled,
 * every row loses the client link, identity and note but keeps neutral time facts.
 */
export const devCalendarClientDeletionParticipant = {
  owner: "calendar.appointments",
  tables: ["calendar_appointments"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM calendar_appointments
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string,
    now: string): Promise<void> {
    const at = new Date(now);
    const today = localDateOf(at);
    await tx.run(`UPDATE calendar_appointments SET lifecycle = 'CANCELLED', cancelled_at = ?
      WHERE workspace_id = ? AND client_id = ? AND lifecycle = 'SCHEDULED'
        AND (local_date > ? OR (local_date = ? AND start_minute >= ?))`,
    [now, workspaceId, clientId, today, today, minuteOfDay(at)]);
    await tx.run(`UPDATE calendar_appointments SET client_id = NULL, guest_name = NULL,
      participant_deleted = 1, note = NULL, revision = revision + 1, updated_at = ?
      WHERE workspace_id = ? AND client_id = ?`, [now, workspaceId, clientId]);
  },
};

/** Explicitly dev-only new-install store sharing the clients dev file. */
export class DevCalendarRepository implements CalendarRepositoryPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: CalendarCommittedChange) => void>();
  private readonly accounting: DevAppointmentAccountingHook | null;

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string,
    accounting: DevAppointmentAccountingHook | null = null) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
    this.accounting = accounting;
  }

  /** The workspace row is created by the clients store, which must initialize first. */
  initialize(): Promise<void> {
    if (this.connection !== null) return Promise.resolve();
    if (this.opening !== null) return this.opening;
    const opening = this.openAndMigrate();
    this.opening = opening;
    void opening.finally(() => { if (this.opening === opening) this.opening = null; })
      .catch(() => undefined);
    return opening;
  }

  private async openAndMigrate(): Promise<void> {
    if (!this.workspaceId.trim()) throw new Error("CALENDAR_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devCalendarCatalog, DEV_CALENDAR_LEDGER);
      await writer.write(async (tx) => {
        const workspace = await tx.first<{ id: string }>(
          "SELECT id FROM workspaces WHERE id = ?", [this.workspaceId]);
        if (workspace === null) throw new Error("CALENDAR_WORKSPACE_UNAVAILABLE");
        // Seeds belong to first setup only; explicitly deleted unused templates must not reappear on restart.
        const configured = await tx.first<{ id: string }>("SELECT workspace_id AS id FROM calendar_settings WHERE workspace_id = ?", [this.workspaceId]);
        if (configured !== null) return;
        const now = new Date().toISOString();
        for (const seed of seedSessionTypes) {
          const existing = await tx.first<{ id: string }>(`SELECT id FROM session_types
            WHERE workspace_id = ? AND seed_key = ?`, [this.workspaceId, seed.key]);
          if (existing !== null) continue;
          await tx.run(`INSERT INTO session_types (id, workspace_id, seed_key, name, category,
            default_duration_minutes, requires_credit, archived_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          [await newId(tx), this.workspaceId, seed.key, seed.name, seed.category, seed.minutes,
            seed.credit, now]);
        }
        await tx.run(`INSERT OR IGNORE INTO calendar_settings (workspace_id, default_session_type_id)
          SELECT ?, id FROM session_types WHERE workspace_id = ? AND seed_key = 'personal'`,
        [this.workspaceId, this.workspaceId]);
      });
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("CALENDAR_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: CalendarCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: CalendarCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  private async settings(tx: SqliteStatementPort): Promise<CalendarSettings> {
    const row = await tx.first<SettingsRow>("SELECT * FROM calendar_settings WHERE workspace_id = ?",
      [this.workspaceId]);
    if (row === null) throw new Error("CALENDAR_STORE_NOT_READY");
    const settings = toSettings(row);
    validateSettings(settings);
    return settings;
  }

  getSettings(): Promise<CalendarSettings> { return this.settings(this.ready().connection); }

  async listSessionTypes(): Promise<readonly SessionType[]> {
    const rows = await this.ready().connection.all<SessionTypeRow>(`SELECT ${sessionTypeColumns}
      FROM session_types WHERE workspace_id = ? ORDER BY created_at, rowid`, [this.workspaceId]);
    return rows.map(toSessionType);
  }

  async listRange(from: LocalDate, to: LocalDate): Promise<Readonly<{
    appointments: readonly Appointment[]; intervals: readonly CalendarInterval[];
  }>> {
    if (!isLocalDate(from) || !isLocalDate(to) || to < from) throw new Error("CALENDAR_DATE_INVALID");
    const { connection } = this.ready();
    const [appointments, intervals] = await Promise.all([
      connection.all<AppointmentRow>(`SELECT ${appointmentColumns} FROM calendar_appointments
        WHERE workspace_id = ? AND local_date BETWEEN ? AND ? AND lifecycle <> 'CANCELLED'
        ORDER BY local_date, start_minute, id`, [this.workspaceId, from, to]),
      connection.all<CalendarInterval>(`SELECT ${intervalColumns} FROM calendar_intervals
        WHERE workspace_id = ? AND local_date BETWEEN ? AND ?
        ORDER BY local_date, start_minute, id`, [this.workspaceId, from, to]),
    ]);
    return { appointments: appointments.map(toAppointment), intervals };
  }

  async summarize(from: LocalDate, to: LocalDate): Promise<readonly DaySummary[]> {
    if (!isLocalDate(from) || !isLocalDate(to) || to < from) throw new Error("CALENDAR_DATE_INVALID");
    return this.ready().connection.all<DaySummary>(`SELECT local_date AS localDate,
      count(*) AS appointments FROM calendar_appointments
      WHERE workspace_id = ? AND local_date BETWEEN ? AND ? AND lifecycle IN ('SCHEDULED','COMPLETED')
      GROUP BY local_date ORDER BY local_date`, [this.workspaceId, from, to]);
  }

  async getAppointment(id: string): Promise<Appointment | null> {
    const row = await this.ready().connection.first<AppointmentRow>(`SELECT ${appointmentColumns}
      FROM calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
    return row === null ? null : toAppointment(row);
  }

  private async appointmentById(tx: SqliteStatementPort, id: string): Promise<Appointment> {
    const row = await tx.first<AppointmentRow>(`SELECT ${appointmentColumns}
      FROM calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
    if (row === null) throw new Error("CALENDAR_STALE_APPOINTMENT");
    return toAppointment(row);
  }

  async createAppointment(input: AppointmentInput): Promise<Appointment> {
    const created = await this.ready().writer.write(async (tx) => {
      const valid = validateAppointment(input, await this.settings(tx), true);
      const type = await activeSessionType(tx, this.workspaceId, valid.sessionTypeId);
      if (type === null) throw new Error("CALENDAR_SESSION_TYPE_UNAVAILABLE");
      const conflict = await appointmentConflict(tx, this.workspaceId, valid.localDate,
        valid.startMinute, valid.startMinute + valid.durationMinutes, null);
      if (conflict !== null) throw new Error(conflict);
      const credit = booking(valid, type.requiresCredit === 1);
      const packId = await this.accounting?.plan(tx, this.workspaceId, credit) ?? null;
      const id = await insertAppointment(tx, this.workspaceId, valid, type);
      if (packId !== null) await this.accounting?.reserve(tx, this.workspaceId, id, credit, packId);
      return this.appointmentById(tx, id);
    });
    this.publish({ dates: [created.localDate] });
    return created;
  }

  async updateAppointment(id: string, expectedRevision: number,
    input: AppointmentInput): Promise<Appointment> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("CALENDAR_STALE_APPOINTMENT");
    }
    let previousDate = "";
    const updated = await this.ready().writer.write(async (tx) => {
      const current = await this.appointmentById(tx, id);
      if (current.lifecycle !== "SCHEDULED" || current.revision !== expectedRevision) {
        throw new Error("CALENDAR_STALE_APPOINTMENT");
      }
      previousDate = current.localDate;
      const moved = current.localDate !== input.localDate || current.startMinute !== input.startMinute
        || current.durationMinutes !== input.durationMinutes;
      const valid = validateAppointment(input, await this.settings(tx), moved);
      const type = valid.sessionTypeId === current.sessionTypeId
        ? await tx.first<SessionTypeRow>(`SELECT ${sessionTypeColumns} FROM session_types
            WHERE workspace_id = ? AND id = ?`, [this.workspaceId, valid.sessionTypeId])
        : await activeSessionType(tx, this.workspaceId, valid.sessionTypeId);
      if (type === null) throw new Error("CALENDAR_SESSION_TYPE_UNAVAILABLE");
      const conflict = await appointmentConflict(tx, this.workspaceId, valid.localDate,
        valid.startMinute, valid.startMinute + valid.durationMinutes, id);
      if (conflict !== null) throw new Error(conflict);
      const keepSnapshot = type.id === current.sessionTypeId;
      const currentRequires = (await tx.first<{ r: number }>(`SELECT session_type_requires_credit AS r
        FROM calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]))?.r === 1;
      const next = booking(valid, keepSnapshot ? currentRequires : type.requiresCredit === 1);
      const creditChanged = current.clientId !== valid.clientId || current.sessionTypeId !== valid.sessionTypeId
        || current.creditBypass !== (valid.creditBypass === true);
      let packId: string | null = null;
      if (this.accounting !== null && creditChanged) {
        await this.accounting.release(tx, this.workspaceId, id);
        packId = await this.accounting.plan(tx, this.workspaceId, next);
      } else if (this.accounting !== null && moved) {
        await this.accounting.move(tx, this.workspaceId, id, next);
      }
      const result = await tx.run(`UPDATE calendar_appointments SET local_date = ?,
        start_minute = ?, duration_minutes = ?, client_id = ?, guest_name = ?, session_type_id = ?,
        session_type_name = CASE WHEN ? THEN session_type_name ELSE ? END,
        session_type_category = CASE WHEN ? THEN session_type_category ELSE ? END,
        session_type_requires_credit = CASE WHEN ? THEN session_type_requires_credit ELSE ? END,
        note = ?, credit_bypass = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = 'SCHEDULED'`,
      [valid.localDate, valid.startMinute, valid.durationMinutes, valid.clientId, valid.guestName,
        type.id, keepSnapshot ? 1 : 0, type.name, keepSnapshot ? 1 : 0, type.category,
        keepSnapshot ? 1 : 0, type.requiresCredit, valid.note, valid.creditBypass === true ? 1 : 0,
        new Date().toISOString(), this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
      if (packId !== null) await this.accounting?.reserve(tx, this.workspaceId, id, next, packId);
      return this.appointmentById(tx, id);
    });
    this.publish({ dates: [...new Set([previousDate, updated.localDate])] });
    return updated;
  }

  async cancelAppointment(id: string, expectedRevision: number,
    settlement: CancelSettlement = "RETURN"): Promise<void> {
    let date = "";
    await this.ready().writer.write(async (tx) => {
      const current = await this.appointmentById(tx, id);
      date = current.localDate;
      const now = new Date().toISOString();
      const result = await tx.run(`UPDATE calendar_appointments SET lifecycle = 'CANCELLED',
        cancelled_at = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = 'SCHEDULED'`,
      [now, now, this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
      await this.accounting?.cancel(tx, this.workspaceId, id, settlement, now);
    });
    this.publish({ dates: [date] });
  }

  async resolveOutcome(id: string, expectedRevision: number, outcome: AppointmentOutcome,
    now: Date = new Date()): Promise<Appointment> {
    if (outcome !== "COMPLETED" && outcome !== "MISSED" && outcome !== "CANCELLED") {
      throw new Error("CALENDAR_OUTCOME_INVALID");
    }
    let changed = false;
    const resolved = await this.ready().writer.write(async (tx) => {
      const current = await this.appointmentById(tx, id);
      if (current.revision !== expectedRevision || current.lifecycle === "CANCELLED") {
        throw new Error("CALENDAR_STALE_APPOINTMENT");
      }
      if (current.outcome === outcome) return current;
      const stamp = now.toISOString();
      if (outcome === "CANCELLED") {
        const result = await tx.run(`UPDATE calendar_appointments SET lifecycle = 'CANCELLED',
          outcome = 'CANCELLED', outcome_at = ?, cancelled_at = ?, revision = revision + 1, updated_at = ?
          WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle <> 'CANCELLED'`,
        [stamp, stamp, stamp, this.workspaceId, id, expectedRevision]);
        if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
        // A charged session gets one linked RETURNED; a reservation is only released (§48.35.6).
        await this.accounting?.cancel(tx, this.workspaceId, id, "RETURN", stamp);
      } else {
        if (!appointmentStarted(current, now)) throw new Error("CALENDAR_OUTCOME_TOO_EARLY");
        const result = await tx.run(`UPDATE calendar_appointments SET lifecycle = 'COMPLETED',
          outcome = ?, outcome_at = ?, revision = revision + 1, updated_at = ?
          WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle <> 'CANCELLED'`,
        [outcome, stamp, stamp, this.workspaceId, id, expectedRevision]);
        if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
        // Завершена and Пропущена both keep exactly one USED; the timer will find no reservation.
        await this.accounting?.settle(tx, this.workspaceId, id, stamp);
      }
      changed = true;
      return this.appointmentById(tx, id);
    });
    if (changed) this.publish({ dates: [resolved.localDate] });
    return resolved;
  }

  async clearOutcome(id: string, expectedRevision: number): Promise<Appointment> {
    const cleared = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE calendar_appointments SET lifecycle = 'SCHEDULED',
        outcome = NULL, outcome_at = NULL, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = 'COMPLETED'`,
      [new Date().toISOString(), this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
      return this.appointmentById(tx, id);
    });
    this.publish({ dates: [cleared.localDate] });
    return cleared;
  }

  async correctClient(id: string, expectedRevision: number, clientId: string,
    now: Date = new Date()): Promise<Appointment> {
    const target = clientId.trim();
    const corrected = await this.ready().writer.write(async (tx) => {
      const current = await this.appointmentById(tx, id);
      if (current.revision !== expectedRevision) throw new Error("CALENDAR_STALE_APPOINTMENT");
      if (current.lifecycle === "CANCELLED" || current.clientId === null || !target
        || target === current.clientId || !appointmentStarted(current, now)) {
        throw new Error("CALENDAR_CORRECTION_INVALID");
      }
      const requires = (await tx.first<{ r: number }>(`SELECT session_type_requires_credit AS r
        FROM calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]))?.r === 1;
      const stamp = now.toISOString();
      // Release the old reservation and write compensating ledger facts before changing its owner.
      // Everything remains inside this transaction; the new owner guard never observes a stale reservation.
      await this.accounting?.correct(tx, this.workspaceId, id, { clientId: target,
        sessionTypeId: current.sessionTypeId, requiresCredit: requires, bypass: current.creditBypass,
        localDate: current.localDate, endMinute: current.startMinute + current.durationMinutes }, stamp);
      const result = await tx.run(`UPDATE calendar_appointments SET client_id = ?,
        revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle <> 'CANCELLED'`,
      [target, stamp, this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
      return this.appointmentById(tx, id);
    });
    this.publish({ dates: [corrected.localDate] });
    return corrected;
  }

  async restoreCancelled(id: string, expectedRevision: number, previousOutcome: "COMPLETED" | "MISSED" | null,
    now: Date = new Date()): Promise<Appointment> {
    const restored = await this.ready().writer.write(async (tx) => {
      const current = await this.appointmentById(tx, id);
      if (current.revision !== expectedRevision) throw new Error("CALENDAR_STALE_APPOINTMENT");
      // Only «Отменена» chosen as an outcome is undone; a deleted future booking stays deleted.
      if (current.lifecycle !== "CANCELLED" || current.outcome !== "CANCELLED" || current.participantDeleted
        || (previousOutcome !== null && previousOutcome !== "COMPLETED" && previousOutcome !== "MISSED")
        || (previousOutcome !== null && !appointmentStarted(current, now))) {
        throw new Error("CALENDAR_RESTORE_INVALID");
      }
      const conflict = await appointmentConflict(tx, this.workspaceId, current.localDate, current.startMinute,
        current.startMinute + current.durationMinutes, id);
      if (conflict !== null) throw new Error(conflict);
      const stamp = now.toISOString();
      const result = await tx.run(`UPDATE calendar_appointments SET lifecycle = ?, outcome = ?,
        outcome_at = ?, cancelled_at = NULL, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = 'CANCELLED'`,
      [previousOutcome === null ? "SCHEDULED" : "COMPLETED", previousOutcome,
        previousOutcome === null ? null : stamp, stamp, this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
      const requires = (await tx.first<{ r: number }>(`SELECT session_type_requires_credit AS r
        FROM calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]))?.r === 1;
      await this.accounting?.restore(tx, this.workspaceId, id, { clientId: current.clientId,
        sessionTypeId: current.sessionTypeId, requiresCredit: requires, bypass: current.creditBypass,
        localDate: current.localDate, endMinute: current.startMinute + current.durationMinutes },
      previousOutcome !== null || appointmentEnded(current, now), stamp);
      return this.appointmentById(tx, id);
    });
    this.publish({ dates: [restored.localDate] });
    return restored;
  }

  private async sessionTypeById(tx: SqliteStatementPort, id: string): Promise<SessionType> {
    const row = await tx.first<SessionTypeRow>(`SELECT ${sessionTypeColumns} FROM session_types
      WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
    if (row === null) throw new Error("CALENDAR_SESSION_TYPE_UNAVAILABLE");
    return toSessionType(row);
  }

  async createSessionType(input: SessionTypeInput): Promise<SessionType> {
    const valid = validateSessionType(input);
    const created = await this.ready().writer.write(async (tx) => {
      const id = await newId(tx);
      await tx.run(`INSERT INTO session_types (id, workspace_id, seed_key, name, category,
          default_duration_minutes, requires_credit, archived_at, created_at, color)
        VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)`,
      [id, this.workspaceId, valid.name, valid.category, valid.defaultDurationMinutes,
        valid.requiresCredit ? 1 : 0, new Date().toISOString(), valid.color]);
      return this.sessionTypeById(tx, id);
    });
    this.publish({ dates: "ALL" });
    return created;
  }

  async updateSessionType(id: string, input: SessionTypeInput): Promise<SessionType> {
    const valid = validateSessionType(input);
    const updated = await this.ready().writer.write(async (tx) => {
      const current = await this.sessionTypeById(tx, id);
      // A used type keeps its credit semantics; a new type is the way to change them (§13.8).
      if (current.inUse && current.requiresCredit !== valid.requiresCredit) {
        throw new Error("CALENDAR_SESSION_TYPE_CREDIT_LOCKED");
      }
      await tx.run(`UPDATE session_types SET name = ?, category = ?, default_duration_minutes = ?,
          requires_credit = ?, color = ? WHERE workspace_id = ? AND id = ?`,
      [valid.name, valid.category, valid.defaultDurationMinutes, valid.requiresCredit ? 1 : 0, valid.color,
        this.workspaceId, id]);
      return this.sessionTypeById(tx, id);
    });
    this.publish({ dates: "ALL" });
    return updated;
  }

  async deleteSessionType(id: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      const current = await this.sessionTypeById(tx, id);
      if ((await this.settings(tx)).defaultSessionTypeId === id) throw new Error("CALENDAR_DEFAULT_TYPE_DELETE");
      if (current.inUse) throw new Error("CALENDAR_SESSION_TYPE_IN_USE");
      try {
        await tx.run("DELETE FROM session_types WHERE workspace_id = ? AND id = ?", [this.workspaceId, id]);
      } catch (error) {
        // Foreign-key owners (e.g. credit packs) retain the type without Calendar querying their tables.
        if (error instanceof Error && /foreign key/iu.test(error.message)) throw new Error("CALENDAR_SESSION_TYPE_IN_USE", { cause: error });
        throw error;
      }
    });
    this.publish({ dates: "ALL" });
  }

  async setSessionTypeArchived(id: string, archived: boolean): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await this.sessionTypeById(tx, id);
      if (archived && (await this.settings(tx)).defaultSessionTypeId === id) {
        throw new Error("CALENDAR_DEFAULT_TYPE_ARCHIVE");
      }
      await tx.run(`UPDATE session_types SET archived_at = ? WHERE workspace_id = ? AND id = ?`,
        [archived ? new Date().toISOString() : null, this.workspaceId, id]);
    });
    this.publish({ dates: "ALL" });
  }

  async setDefaultSessionType(id: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      if (await activeSessionType(tx, this.workspaceId, id) === null) throw new Error("CALENDAR_SESSION_TYPE_UNAVAILABLE");
      await tx.run("UPDATE calendar_settings SET default_session_type_id = ? WHERE workspace_id = ?",
        [id, this.workspaceId]);
    });
    this.publish({ dates: "ALL" });
  }

  async updatePolicies(input: Readonly<{ copyPolicy: CategoryPolicy; clearPolicy: CategoryPolicy }>): Promise<CalendarSettings> {
    const flag = (value: boolean) => (value ? 1 : 0);
    const updated = await this.ready().writer.write(async (tx) => {
      await tx.run(`UPDATE calendar_settings SET copy_appointments = ?, copy_duty = ?, copy_blocked = ?,
          clear_appointments = ?, clear_duty = ?, clear_blocked = ? WHERE workspace_id = ?`,
      [flag(input.copyPolicy.appointments), flag(input.copyPolicy.duty), flag(input.copyPolicy.blocked),
        flag(input.clearPolicy.appointments), flag(input.clearPolicy.duty), flag(input.clearPolicy.blocked),
        this.workspaceId]);
      return this.settings(tx);
    });
    this.publish({ dates: "ALL" });
    return updated;
  }

  async resetSettings(): Promise<CalendarSettings> {
    const reset = await this.ready().writer.write(async (tx) => {
      // The seed «Персональная тренировка» is the safe default; if archived, the first active type.
      const fallback = await tx.first<{ id: string }>(`SELECT id FROM session_types
        WHERE workspace_id = ? AND archived_at IS NULL ORDER BY (seed_key = 'personal') DESC, created_at, rowid LIMIT 1`,
      [this.workspaceId]);
      await tx.run(`UPDATE calendar_settings SET copy_appointments = 1, copy_duty = 1, copy_blocked = 1,
          clear_appointments = 1, clear_duty = 1, clear_blocked = 1, undo_cancel_prompt = 1,
          default_session_type_id = ? WHERE workspace_id = ?`, [fallback?.id ?? null, this.workspaceId]);
      return this.settings(tx);
    });
    this.publish({ dates: "ALL" });
    return reset;
  }

  async updateDisplaySettings(input: Readonly<{ visibleWeekdays: readonly boolean[]; dayStartMinute: number;
    dayEndMinute: number }>): Promise<CalendarSettings> {
    const updated = await this.ready().writer.write(async (tx) => {
      validateSettings({ ...(await this.settings(tx)), ...input });
      await tx.run(`UPDATE calendar_settings SET visible_weekdays = ?, day_start_minute = ?, day_end_minute = ?
        WHERE workspace_id = ?`, [input.visibleWeekdays.map((flag) => (flag ? "1" : "0")).join(""),
        input.dayStartMinute, input.dayEndMinute, this.workspaceId]);
      return this.settings(tx);
    });
    this.publish({ dates: "ALL" });
    return updated;
  }

  async setUndoCancelPrompt(enabled: boolean): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run("UPDATE calendar_settings SET undo_cancel_prompt = ? WHERE workspace_id = ?",
        [enabled ? 1 : 0, this.workspaceId]);
    });
  }

  private async sameGuest(tx: SqliteStatementPort, row: Appointment): Promise<readonly Appointment[]> {
    const name = row.guestName;
    if (name === null) return [];
    const rows = await tx.all<AppointmentRow>(`SELECT ${appointmentColumns} FROM calendar_appointments
      WHERE workspace_id = ? AND guest_name IS NOT NULL AND lifecycle <> 'CANCELLED' AND id <> ?
      ORDER BY local_date, start_minute, id`, [this.workspaceId, row.id]);
    // SQLite lower() is ASCII-only, so Cyrillic names are compared here.
    return rows.map(toAppointment).filter((other) => other.guestName !== null && sameGuestName(other.guestName, name));
  }

  async countSameGuest(appointmentId: string): Promise<number> {
    const { connection } = this.ready();
    const row = await connection.first<AppointmentRow>(`SELECT ${appointmentColumns}
      FROM calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, appointmentId]);
    return row === null ? 0 : (await this.sameGuest(connection, toAppointment(row))).length;
  }

  async linkGuestToClient(appointmentId: string, expectedRevision: number | null, clientId: string,
    includeSameName: boolean, now: Date = new Date()): Promise<number> {
    const target = clientId.trim();
    const dates = new Set<string>();
    const linked = await this.ready().writer.write(async (tx) => {
      const current = await this.appointmentById(tx, appointmentId);
      if (expectedRevision !== null && current.revision !== expectedRevision) {
        throw new Error("CALENDAR_STALE_APPOINTMENT");
      }
      if (current.guestName === null || current.lifecycle === "CANCELLED" || !target) {
        throw new Error("CALENDAR_GUEST_LINK_INVALID");
      }
      const rows = [current, ...(includeSameName ? await this.sameGuest(tx, current) : [])];
      const stamp = now.toISOString();
      for (const row of rows) {
        const result = await tx.run(`UPDATE calendar_appointments SET client_id = ?, guest_name = NULL,
          revision = revision + 1, updated_at = ?
          WHERE workspace_id = ? AND id = ? AND guest_name IS NOT NULL AND lifecycle <> 'CANCELLED'`,
        [target, stamp, this.workspaceId, row.id]);
        if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
        dates.add(row.localDate);
        // A guest visit was never accounted, so only records that have not started book a credit.
        if (this.accounting === null || appointmentStarted(row, now)) continue;
        const requires = (await tx.first<{ r: number }>(`SELECT session_type_requires_credit AS r
          FROM calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, row.id]))?.r === 1;
        const booking = { clientId: target, sessionTypeId: row.sessionTypeId, requiresCredit: requires,
          bypass: row.creditBypass, localDate: row.localDate, endMinute: row.startMinute + row.durationMinutes };
        let packId: string | null = null;
        try {
          packId = await this.accounting.plan(tx, this.workspaceId, booking);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "ACCOUNTING_INSUFFICIENT_CREDIT") throw error;
          // No credits yet must not block the link: the record is kept «без списания» explicitly.
          await tx.run("UPDATE calendar_appointments SET credit_bypass = 1 WHERE workspace_id = ? AND id = ?",
            [this.workspaceId, row.id]);
        }
        if (packId !== null) await this.accounting.reserve(tx, this.workspaceId, row.id, booking, packId);
      }
      return rows.length;
    });
    this.publish({ dates: [...dates] });
    return linked;
  }

  async listPendingOutcomes(now: Date): Promise<readonly Appointment[]> {
    const today = localDateOf(now);
    const rows = await this.ready().connection.all<AppointmentRow>(`SELECT ${appointmentColumns}
      FROM calendar_appointments WHERE workspace_id = ? AND lifecycle = 'SCHEDULED'
        AND participant_deleted = 0
        AND (local_date < ? OR (local_date = ? AND start_minute + duration_minutes <= ?))
      ORDER BY local_date, start_minute, id`, [this.workspaceId, today, today, minuteOfDay(now)]);
    return rows.map(toAppointment);
  }

  async createInterval(input: IntervalInput): Promise<CalendarInterval> {
    const valid = validateInterval(input);
    const created = await this.ready().writer.write(async (tx) => {
      const conflict = await intervalConflict(tx, this.workspaceId, valid);
      if (conflict !== null) throw new Error(conflict);
      const id = await insertInterval(tx, this.workspaceId, valid);
      const row = await tx.first<CalendarInterval>(`SELECT ${intervalColumns}
        FROM calendar_intervals WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
      if (row === null) throw new Error("CALENDAR_ID_UNAVAILABLE");
      return row;
    });
    this.publish({ dates: [created.localDate] });
    return created;
  }

  async reshapeIntervals(removeIds: readonly string[], create: readonly IntervalInput[]): Promise<void> {
    const valid = create.map(validateInterval);
    const dates = new Set<string>();
    await this.ready().writer.write(async (tx) => {
      for (const id of removeIds) {
        const row = await tx.first<{ localDate: string }>(`SELECT local_date AS localDate
          FROM calendar_intervals WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
        if (row === null) throw new Error("CALENDAR_INTERVAL_NOT_FOUND");
        dates.add(row.localDate);
        await tx.run("DELETE FROM calendar_intervals WHERE workspace_id = ? AND id = ?", [this.workspaceId, id]);
      }
      // Проверка пересечений видит уже удалённые интервалы как свободное время; любой конфликт откатывает всё.
      for (const input of valid) {
        const conflict = await intervalConflict(tx, this.workspaceId, input);
        if (conflict !== null) throw new Error(conflict);
        await insertInterval(tx, this.workspaceId, input);
        dates.add(input.localDate);
      }
    });
    if (dates.size > 0) this.publish({ dates: [...dates] });
  }

  async removeInterval(id: string): Promise<void> {
    let date = "";
    await this.ready().writer.write(async (tx) => {
      const row = await tx.first<{ localDate: string }>(`SELECT local_date AS localDate
        FROM calendar_intervals WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
      if (row === null) throw new Error("CALENDAR_INTERVAL_NOT_FOUND");
      date = row.localDate;
      await tx.run("DELETE FROM calendar_intervals WHERE workspace_id = ? AND id = ?",
        [this.workspaceId, id]);
    });
    this.publish({ dates: [date] });
  }

  async copyWeek(monday: LocalDate): Promise<WeekTemplate> {
    const { connection } = this.ready();
    const settings = await this.settings(connection);
    const { appointments, intervals } = await this.listRange(monday, addDays(monday, 6));
    return buildWeekTemplate(monday, appointments, intervals, settings.copyPolicy);
  }

  async pasteWeek(monday: LocalDate, template: WeekTemplate,
    eligibleClientIds: ReadonlySet<string>): Promise<PasteResult> {
    const dates = weekDates(monday);
    const result = await this.ready().writer.write(async (tx) => {
      const settings = await this.settings(tx);
      let inserted = 0;
      let skippedBusy = 0;
      let skippedUnavailable = 0;
      for (const entry of template.appointments) {
        const localDate = dates[entry.weekdayIndex];
        if (localDate === undefined) throw new Error("CALENDAR_TEMPLATE_INVALID");
        const valid = validateAppointment({ ...entry, localDate }, settings, false);
        const type = await activeSessionType(tx, this.workspaceId, valid.sessionTypeId);
        if (type === null || (valid.clientId !== null && !eligibleClientIds.has(valid.clientId))) {
          skippedUnavailable += 1;
          continue;
        }
        if (await appointmentConflict(tx, this.workspaceId, localDate, valid.startMinute,
          valid.startMinute + valid.durationMinutes, null) !== null) {
          skippedBusy += 1;
          continue;
        }
        // Credits are recalculated for the new week; a prior bypass is never inherited (§13.15).
        const credit = booking(valid, type.requiresCredit === 1);
        let packId: string | null;
        try { packId = await this.accounting?.plan(tx, this.workspaceId, credit) ?? null; }
        catch (error) {
          if (error instanceof Error && error.message === "ACCOUNTING_INSUFFICIENT_CREDIT") {
            skippedUnavailable += 1;
            continue;
          }
          throw error;
        }
        const id = await insertAppointment(tx, this.workspaceId, valid, type);
        if (packId !== null) await this.accounting?.reserve(tx, this.workspaceId, id, credit, packId);
        inserted += 1;
      }
      for (const entry of template.intervals) {
        const localDate = dates[entry.weekdayIndex];
        if (localDate === undefined) throw new Error("CALENDAR_TEMPLATE_INVALID");
        const valid = validateInterval({ ...entry, localDate });
        if (await intervalConflict(tx, this.workspaceId, valid) !== null) {
          skippedBusy += 1;
          continue;
        }
        await insertInterval(tx, this.workspaceId, valid);
        inserted += 1;
      }
      return { inserted, skippedBusy, skippedUnavailable };
    });
    if (result.inserted > 0) this.publish({ dates });
    return result;
  }

  previewClearWeek(monday: LocalDate, now: Date = new Date()): Promise<ClearWeekSummary> {
    const { connection } = this.ready();
    return this.settings(connection).then((settings) =>
      countClearWeek(connection, this.workspaceId, monday, settings, now));
  }

  async clearWeek(monday: LocalDate, now: Date = new Date()): Promise<ClearWeekSummary> {
    if (!isLocalDate(monday)) throw new Error("CALENDAR_DATE_INVALID");
    const sunday = addDays(monday, 6);
    const summary = await this.ready().writer.write(async (tx) => {
      const settings = await this.settings(tx);
      const counted = await countClearWeek(tx, this.workspaceId, monday, settings, now);
      const stamp = now.toISOString();
      if (settings.clearPolicy.appointments) {
        // Only rows that have not started: bulk clear releases their reservations and never
        // charges; past and running rows keep their outcome and USED (§13.14, §48.35).
        const cleared = await tx.all<{ id: string }>(`SELECT id FROM calendar_appointments
          WHERE workspace_id = ? AND local_date BETWEEN ? AND ? AND lifecycle = 'SCHEDULED'
            AND ${NOT_STARTED_SQL}`, [this.workspaceId, monday, sunday, ...notStartedParams(now)]);
        for (const row of cleared) {
          await this.accounting?.cancel(tx, this.workspaceId, row.id, "RETURN", stamp);
          await tx.run(`UPDATE calendar_appointments SET lifecycle = 'CANCELLED', cancelled_at = ?,
            revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ?`,
          [stamp, stamp, this.workspaceId, row.id]);
        }
      }
      const kinds = [settings.clearPolicy.duty ? "DUTY" : null,
        settings.clearPolicy.blocked ? "BLOCKED" : null].filter((kind) => kind !== null);
      for (const kind of kinds) {
        await tx.run(`DELETE FROM calendar_intervals
          WHERE workspace_id = ? AND local_date BETWEEN ? AND ? AND kind = ? AND ${NOT_STARTED_SQL}`,
        [this.workspaceId, monday, sunday, kind, ...notStartedParams(now)]);
      }
      return counted;
    });
    this.publish({ dates: weekDates(monday) });
    return summary;
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
