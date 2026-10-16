import type { DatabaseSync } from "node:sqlite";

export interface LegacyCalendarSource {
  readonly accountScope: string;
  readonly sourceRowId: string;
  readonly dateValid: boolean;
  readonly ownerStatus: "client" | "guest" | "unassigned" | "missing-client" | "both";
  readonly typeStatus: "training" | "guest_visit" | "initial_instruction" | "unknown";
  readonly deleted: boolean;
  readonly timeStatus: "consistent" | "invalid-shape" | "invalid-duration" | "end-mismatch";
}

function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function minuteOfDay(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

/** Calendar source rows do not prove a performed workout or a credit settlement. */
export function readLegacyCalendarRowsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyCalendarSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const required = ["id", "date_key", "start_time", "end_time", "duration_minutes",
    "client_id", "guest_name", "appointment_type", "deleted_at"];
  const columns = new Set(db.prepare("PRAGMA table_info('calendar_appointments')").all()
    .map((row) => String(row.name)));
  if (required.some((column) => !columns.has(column))) throw new Error("R04_CALENDAR_SHAPE_UNSUPPORTED");
  const rows = db.prepare(`SELECT a.id AS sourceRowId, a.date_key AS dateKey,
    a.start_time AS startTime, a.end_time AS endTime,
    a.duration_minutes AS durationMinutes, a.client_id AS clientId,
    a.guest_name AS guestName, a.appointment_type AS appointmentType,
    a.deleted_at AS deletedAt, c.id AS ownerClientId
    FROM calendar_appointments a LEFT JOIN clients c ON c.id=a.client_id
    ORDER BY a.id`).all();
  const count = db.prepare("SELECT count(*) AS count FROM calendar_appointments").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_CALENDAR_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyCalendarSource => {
    if (typeof row.sourceRowId !== "string" || !row.sourceRowId.trim()) {
      throw new Error("R04_CALENDAR_PROVENANCE_INCOMPLETE");
    }
    const client = typeof row.clientId === "string" && !!row.clientId.trim();
    const guest = typeof row.guestName === "string" && !!row.guestName.trim();
    const ownerStatus = client && guest ? "both" : client
      ? row.ownerClientId === row.clientId ? "client" : "missing-client"
      : guest ? "guest" : "unassigned";
    const typeStatus = row.appointmentType === "training"
      || row.appointmentType === "guest_visit"
      || row.appointmentType === "initial_instruction"
      ? row.appointmentType : "unknown";
    const start = minuteOfDay(row.startTime);
    const end = minuteOfDay(row.endTime);
    const duration = row.durationMinutes;
    const timeStatus = start === null || end === null ? "invalid-shape"
      : typeof duration !== "number" || !Number.isSafeInteger(duration)
        || duration <= 0 || duration >= 1440 ? "invalid-duration"
        : (start + duration) % 1440 !== end ? "end-mismatch" : "consistent";
    return {
      accountScope, sourceRowId: row.sourceRowId,
      dateValid: validDate(row.dateKey), ownerStatus, typeStatus,
      deleted: row.deletedAt !== null, timeStatus,
    };
  });
}
