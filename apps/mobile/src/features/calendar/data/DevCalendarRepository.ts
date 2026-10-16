import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { Appointment, AppointmentInput, CalendarInterval, CalendarSettings, ClearWeekSummary,
  DaySummary, IntervalInput, LocalDate, PasteResult, SessionType, SessionTypeCategory,
  WeekTemplate } from "../domain/CalendarModel.ts";
import type { CalendarCommittedChange, CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { addDays, buildWeekTemplate, isLocalDate, localDateOf, minuteOfDay, validateAppointment,
  validateInterval, validateSettings, weekDates } from "../domain/CalendarRules.ts";
import { DEV_CALENDAR_LEDGER, devCalendarCatalog } from "./DevCalendarCatalog.ts";

interface AppointmentRow {
  id: string; localDate: string; startMinute: number; durationMinutes: number;
  clientId: string | null; guestName: string | null; participantDeleted: number;
  sessionTypeId: string; sessionTypeName: string; note: string | null;
  lifecycle: Appointment["lifecycle"]; revision: number;
}

interface SessionTypeRow {
  id: string; name: string; category: SessionTypeCategory; defaultDurationMinutes: number;
  requiresCredit: number; archivedAt: string | null;
}

interface SettingsRow {
  day_start_minute: number; day_end_minute: number; visible_weekdays: string;
  default_session_type_id: string | null;
  copy_appointments: number; copy_duty: number; copy_blocked: number;
  clear_appointments: number; clear_duty: number; clear_blocked: number;
}

const appointmentColumns = `id, local_date AS localDate, start_minute AS startMinute,
  duration_minutes AS durationMinutes, client_id AS clientId, guest_name AS guestName,
  participant_deleted AS participantDeleted, session_type_id AS sessionTypeId,
  session_type_name AS sessionTypeName, note, lifecycle, revision`;

const intervalColumns = `id, kind, local_date AS localDate, start_minute AS startMinute,
  end_minute AS endMinute`;

const sessionTypeColumns = `id, name, category, default_duration_minutes AS defaultDurationMinutes,
  requires_credit AS requiresCredit, archived_at AS archivedAt`;

/** Seed templates of §13.8; trainers may later rename or archive them. */
const seedSessionTypes = [
  { key: "personal", name: "Персональная тренировка", category: "TRAINING", minutes: 60, credit: 1 },
  { key: "instruction", name: "Первичный инструктаж", category: "INSTRUCTION", minutes: 60, credit: 0 },
  { key: "consultation", name: "Консультация", category: "CONSULTATION", minutes: 60, credit: 0 },
  { key: "guest", name: "Гостевой визит", category: "OTHER", minutes: 60, credit: 0 },
] as const;

function toAppointment(row: AppointmentRow): Appointment {
  return { ...row, participantDeleted: row.participantDeleted === 1 };
}

function toSessionType(row: SessionTypeRow): SessionType {
  return { id: row.id, name: row.name, category: row.category,
    defaultDurationMinutes: row.defaultDurationMinutes, requiresCredit: row.requiresCredit === 1,
    archived: row.archivedAt !== null };
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
  };
}

async function newId(tx: SqliteStatementPort): Promise<string> {
  const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
  if (!id) throw new Error("CALENDAR_ID_UNAVAILABLE");
  return id;
}

async function activeSessionType(tx: SqliteStatementPort, workspaceId: string,
  id: string): Promise<SessionTypeRow | null> {
  return tx.first<SessionTypeRow>(`SELECT ${sessionTypeColumns} FROM dev_session_types
    WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`, [workspaceId, id]);
}

async function appointmentConflict(tx: SqliteStatementPort, workspaceId: string, date: LocalDate,
  start: number, end: number, exceptId: string | null): Promise<"CALENDAR_TIME_OVERLAP" | "CALENDAR_BLOCKED_TIME" | null> {
  const busy = await tx.first<{ id: string }>(`SELECT id FROM dev_calendar_appointments
    WHERE workspace_id = ? AND local_date = ? AND lifecycle <> 'CANCELLED' AND id IS NOT ?
      AND start_minute < ? AND start_minute + duration_minutes > ? LIMIT 1`,
  [workspaceId, date, exceptId, end, start]);
  if (busy !== null) return "CALENDAR_TIME_OVERLAP";
  const blocked = await tx.first<{ id: string }>(`SELECT id FROM dev_calendar_intervals
    WHERE workspace_id = ? AND local_date = ? AND kind = 'BLOCKED'
      AND start_minute < ? AND end_minute > ? LIMIT 1`, [workspaceId, date, end, start]);
  return blocked === null ? null : "CALENDAR_BLOCKED_TIME";
}

async function intervalConflict(tx: SqliteStatementPort, workspaceId: string,
  input: IntervalInput): Promise<"CALENDAR_TIME_OVERLAP" | "CALENDAR_BLOCKED_OVER_APPOINTMENT" | null> {
  const sameKind = await tx.first<{ id: string }>(`SELECT id FROM dev_calendar_intervals
    WHERE workspace_id = ? AND local_date = ? AND kind = ? AND start_minute < ? AND end_minute > ?
    LIMIT 1`, [workspaceId, input.localDate, input.kind, input.endMinute, input.startMinute]);
  if (sameKind !== null) return "CALENDAR_TIME_OVERLAP";
  if (input.kind === "DUTY") return null;
  const appointment = await tx.first<{ id: string }>(`SELECT id FROM dev_calendar_appointments
    WHERE workspace_id = ? AND local_date = ? AND lifecycle <> 'CANCELLED'
      AND start_minute < ? AND start_minute + duration_minutes > ? LIMIT 1`,
  [workspaceId, input.localDate, input.endMinute, input.startMinute]);
  return appointment === null ? null : "CALENDAR_BLOCKED_OVER_APPOINTMENT";
}

async function insertAppointment(tx: SqliteStatementPort, workspaceId: string,
  input: AppointmentInput, type: SessionTypeRow): Promise<string> {
  const id = await newId(tx);
  const now = new Date().toISOString();
  await tx.run(`INSERT INTO dev_calendar_appointments
    (id, workspace_id, local_date, start_minute, duration_minutes, client_id, guest_name,
     participant_deleted, session_type_id, session_type_name, session_type_category,
     session_type_requires_credit, note, lifecycle, revision, created_at, updated_at, cancelled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'SCHEDULED', 1, ?, ?, NULL)`,
  [id, workspaceId, input.localDate, input.startMinute, input.durationMinutes, input.clientId,
    input.guestName, type.id, type.name, type.category, type.requiresCredit, input.note, now, now]);
  return id;
}

async function insertInterval(tx: SqliteStatementPort, workspaceId: string,
  input: IntervalInput): Promise<string> {
  const id = await newId(tx);
  await tx.run(`INSERT INTO dev_calendar_intervals
    (id, workspace_id, kind, local_date, start_minute, end_minute, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [id, workspaceId, input.kind, input.localDate, input.startMinute, input.endMinute,
    new Date().toISOString()]);
  return id;
}

async function countClearWeek(tx: SqliteStatementPort, workspaceId: string, monday: LocalDate,
  settings: CalendarSettings): Promise<ClearWeekSummary> {
  const sunday = addDays(monday, 6);
  const appointments = await tx.all<{ lifecycle: string; n: number }>(`SELECT lifecycle, count(*) AS n
    FROM dev_calendar_appointments WHERE workspace_id = ? AND local_date BETWEEN ? AND ?
    GROUP BY lifecycle`, [workspaceId, monday, sunday]);
  const intervals = await tx.all<{ kind: string; n: number }>(`SELECT kind, count(*) AS n
    FROM dev_calendar_intervals WHERE workspace_id = ? AND local_date BETWEEN ? AND ?
    GROUP BY kind`, [workspaceId, monday, sunday]);
  const policy = settings.clearPolicy;
  return {
    scheduledAppointments: policy.appointments
      ? appointments.find((row) => row.lifecycle === "SCHEDULED")?.n ?? 0 : 0,
    completedKept: appointments.find((row) => row.lifecycle === "COMPLETED")?.n ?? 0,
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
  tables: ["dev_calendar_appointments"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_calendar_appointments
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string,
    now: string): Promise<void> {
    const at = new Date(now);
    const today = localDateOf(at);
    await tx.run(`UPDATE dev_calendar_appointments SET lifecycle = 'CANCELLED', cancelled_at = ?
      WHERE workspace_id = ? AND client_id = ? AND lifecycle = 'SCHEDULED'
        AND (local_date > ? OR (local_date = ? AND start_minute >= ?))`,
    [now, workspaceId, clientId, today, today, minuteOfDay(at)]);
    await tx.run(`UPDATE dev_calendar_appointments SET client_id = NULL, guest_name = NULL,
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

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
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
          "SELECT id FROM dev_workspaces WHERE id = ?", [this.workspaceId]);
        if (workspace === null) throw new Error("CALENDAR_WORKSPACE_UNAVAILABLE");
        const now = new Date().toISOString();
        for (const seed of seedSessionTypes) {
          const existing = await tx.first<{ id: string }>(`SELECT id FROM dev_session_types
            WHERE workspace_id = ? AND seed_key = ?`, [this.workspaceId, seed.key]);
          if (existing !== null) continue;
          await tx.run(`INSERT INTO dev_session_types (id, workspace_id, seed_key, name, category,
            default_duration_minutes, requires_credit, archived_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          [await newId(tx), this.workspaceId, seed.key, seed.name, seed.category, seed.minutes,
            seed.credit, now]);
        }
        await tx.run(`INSERT OR IGNORE INTO dev_calendar_settings (workspace_id, default_session_type_id)
          SELECT ?, id FROM dev_session_types WHERE workspace_id = ? AND seed_key = 'personal'`,
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
    const row = await tx.first<SettingsRow>("SELECT * FROM dev_calendar_settings WHERE workspace_id = ?",
      [this.workspaceId]);
    if (row === null) throw new Error("CALENDAR_STORE_NOT_READY");
    const settings = toSettings(row);
    validateSettings(settings);
    return settings;
  }

  getSettings(): Promise<CalendarSettings> { return this.settings(this.ready().connection); }

  async listSessionTypes(): Promise<readonly SessionType[]> {
    const rows = await this.ready().connection.all<SessionTypeRow>(`SELECT ${sessionTypeColumns}
      FROM dev_session_types WHERE workspace_id = ? ORDER BY created_at, rowid`, [this.workspaceId]);
    return rows.map(toSessionType);
  }

  async listRange(from: LocalDate, to: LocalDate): Promise<Readonly<{
    appointments: readonly Appointment[]; intervals: readonly CalendarInterval[];
  }>> {
    if (!isLocalDate(from) || !isLocalDate(to) || to < from) throw new Error("CALENDAR_DATE_INVALID");
    const { connection } = this.ready();
    const [appointments, intervals] = await Promise.all([
      connection.all<AppointmentRow>(`SELECT ${appointmentColumns} FROM dev_calendar_appointments
        WHERE workspace_id = ? AND local_date BETWEEN ? AND ? AND lifecycle <> 'CANCELLED'
        ORDER BY local_date, start_minute, id`, [this.workspaceId, from, to]),
      connection.all<CalendarInterval>(`SELECT ${intervalColumns} FROM dev_calendar_intervals
        WHERE workspace_id = ? AND local_date BETWEEN ? AND ?
        ORDER BY local_date, start_minute, id`, [this.workspaceId, from, to]),
    ]);
    return { appointments: appointments.map(toAppointment), intervals };
  }

  async summarize(from: LocalDate, to: LocalDate): Promise<readonly DaySummary[]> {
    if (!isLocalDate(from) || !isLocalDate(to) || to < from) throw new Error("CALENDAR_DATE_INVALID");
    return this.ready().connection.all<DaySummary>(`SELECT local_date AS localDate,
      count(*) AS appointments FROM dev_calendar_appointments
      WHERE workspace_id = ? AND local_date BETWEEN ? AND ? AND lifecycle IN ('SCHEDULED','COMPLETED')
      GROUP BY local_date ORDER BY local_date`, [this.workspaceId, from, to]);
  }

  async getAppointment(id: string): Promise<Appointment | null> {
    const row = await this.ready().connection.first<AppointmentRow>(`SELECT ${appointmentColumns}
      FROM dev_calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
    return row === null ? null : toAppointment(row);
  }

  private async appointmentById(tx: SqliteStatementPort, id: string): Promise<Appointment> {
    const row = await tx.first<AppointmentRow>(`SELECT ${appointmentColumns}
      FROM dev_calendar_appointments WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
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
      return this.appointmentById(tx, await insertAppointment(tx, this.workspaceId, valid, type));
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
        ? await tx.first<SessionTypeRow>(`SELECT ${sessionTypeColumns} FROM dev_session_types
            WHERE workspace_id = ? AND id = ?`, [this.workspaceId, valid.sessionTypeId])
        : await activeSessionType(tx, this.workspaceId, valid.sessionTypeId);
      if (type === null) throw new Error("CALENDAR_SESSION_TYPE_UNAVAILABLE");
      const conflict = await appointmentConflict(tx, this.workspaceId, valid.localDate,
        valid.startMinute, valid.startMinute + valid.durationMinutes, id);
      if (conflict !== null) throw new Error(conflict);
      const keepSnapshot = type.id === current.sessionTypeId;
      const result = await tx.run(`UPDATE dev_calendar_appointments SET local_date = ?,
        start_minute = ?, duration_minutes = ?, client_id = ?, guest_name = ?, session_type_id = ?,
        session_type_name = CASE WHEN ? THEN session_type_name ELSE ? END,
        session_type_category = CASE WHEN ? THEN session_type_category ELSE ? END,
        session_type_requires_credit = CASE WHEN ? THEN session_type_requires_credit ELSE ? END,
        note = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = 'SCHEDULED'`,
      [valid.localDate, valid.startMinute, valid.durationMinutes, valid.clientId, valid.guestName,
        type.id, keepSnapshot ? 1 : 0, type.name, keepSnapshot ? 1 : 0, type.category,
        keepSnapshot ? 1 : 0, type.requiresCredit, valid.note, new Date().toISOString(),
        this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
      return this.appointmentById(tx, id);
    });
    this.publish({ dates: [...new Set([previousDate, updated.localDate])] });
    return updated;
  }

  async cancelAppointment(id: string, expectedRevision: number): Promise<void> {
    let date = "";
    await this.ready().writer.write(async (tx) => {
      const current = await this.appointmentById(tx, id);
      date = current.localDate;
      const now = new Date().toISOString();
      const result = await tx.run(`UPDATE dev_calendar_appointments SET lifecycle = 'CANCELLED',
        cancelled_at = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = 'SCHEDULED'`,
      [now, now, this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("CALENDAR_STALE_APPOINTMENT");
    });
    this.publish({ dates: [date] });
  }

  async createInterval(input: IntervalInput): Promise<CalendarInterval> {
    const valid = validateInterval(input);
    const created = await this.ready().writer.write(async (tx) => {
      const conflict = await intervalConflict(tx, this.workspaceId, valid);
      if (conflict !== null) throw new Error(conflict);
      const id = await insertInterval(tx, this.workspaceId, valid);
      const row = await tx.first<CalendarInterval>(`SELECT ${intervalColumns}
        FROM dev_calendar_intervals WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
      if (row === null) throw new Error("CALENDAR_ID_UNAVAILABLE");
      return row;
    });
    this.publish({ dates: [created.localDate] });
    return created;
  }

  async removeInterval(id: string): Promise<void> {
    let date = "";
    await this.ready().writer.write(async (tx) => {
      const row = await tx.first<{ localDate: string }>(`SELECT local_date AS localDate
        FROM dev_calendar_intervals WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
      if (row === null) throw new Error("CALENDAR_INTERVAL_NOT_FOUND");
      date = row.localDate;
      await tx.run("DELETE FROM dev_calendar_intervals WHERE workspace_id = ? AND id = ?",
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
        await insertAppointment(tx, this.workspaceId, valid, type);
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

  previewClearWeek(monday: LocalDate): Promise<ClearWeekSummary> {
    const { connection } = this.ready();
    return this.settings(connection).then((settings) =>
      countClearWeek(connection, this.workspaceId, monday, settings));
  }

  async clearWeek(monday: LocalDate): Promise<ClearWeekSummary> {
    if (!isLocalDate(monday)) throw new Error("CALENDAR_DATE_INVALID");
    const sunday = addDays(monday, 6);
    const summary = await this.ready().writer.write(async (tx) => {
      const settings = await this.settings(tx);
      const counted = await countClearWeek(tx, this.workspaceId, monday, settings);
      const now = new Date().toISOString();
      if (settings.clearPolicy.appointments) {
        await tx.run(`UPDATE dev_calendar_appointments SET lifecycle = 'CANCELLED', cancelled_at = ?,
          revision = revision + 1, updated_at = ?
          WHERE workspace_id = ? AND local_date BETWEEN ? AND ? AND lifecycle = 'SCHEDULED'`,
        [now, now, this.workspaceId, monday, sunday]);
      }
      const kinds = [settings.clearPolicy.duty ? "DUTY" : null,
        settings.clearPolicy.blocked ? "BLOCKED" : null].filter((kind) => kind !== null);
      for (const kind of kinds) {
        await tx.run(`DELETE FROM dev_calendar_intervals
          WHERE workspace_id = ? AND local_date BETWEEN ? AND ? AND kind = ?`,
        [this.workspaceId, monday, sunday, kind]);
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
