import type { DatabaseSync } from "node:sqlite";

export type CalendarRaw = Readonly<Record<string, unknown>>;
export const LEGACY_CALENDAR_COLUMNS = ["id", "date_key", "start_time", "end_time", "duration_minutes", "client_id", "guest_name", "client_name", "appointment_type", "note", "created_at", "updated_at", "deleted_at"] as const;
export interface LegacyCalendarSnapshot {
  readonly accountScope: string;
  readonly appointments: readonly CalendarRaw[] | null;
  /** Only the Calendar-owned key; other app_settings belong to other adapters. */
  readonly plannerRows: readonly CalendarRaw[] | null;
  readonly unsupportedAccountingTables: readonly string[];
}
export function readLegacyCalendarSnapshot(db: DatabaseSync, accountScope: string): LegacyCalendarSnapshot {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const present = (table: string) => {
    const row = db.prepare("SELECT type FROM sqlite_schema WHERE lower(name)=?").get(table);
    if (row && row.type !== "table") throw new Error("R04_CALENDAR_SOURCE_SHAPE_UNSUPPORTED");
    return row !== undefined;
  };
  const read = (table: string, required: readonly string[], key?: string): readonly CalendarRaw[] | null => {
    if (!present(table)) return null;
    const columns = new Set(db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((row) => row.name));
    if (required.some((name) => !columns.has(name))) throw new Error("R04_CALENDAR_SOURCE_SHAPE_UNSUPPORTED");
    const suffix = key === undefined ? "" : " WHERE key=?", args = key === undefined ? [] : [key];
    const rows = db.prepare(`SELECT * FROM ${table}${suffix}`).all(...args).map((row) => ({ ...row }));
    if (rows.length !== db.prepare(`SELECT count(*) AS n FROM ${table}${suffix}`).get(...args)?.n) throw new Error("R04_CALENDAR_SOURCE_COVERAGE_MISMATCH");
    return rows;
  };
  const unsupportedAccountingTables = ["accounting_settings", "client_accounting", "session_packs", "credit_ledger", "credit_reservations", "payment_records", "client_preferred_packs"].filter(present);
  return { accountScope, appointments: read("calendar_appointments", LEGACY_CALENDAR_COLUMNS),
    plannerRows: read("app_settings", ["key", "value", "updated_at"], "calendar_planner_settings"), unsupportedAccountingTables };
}
