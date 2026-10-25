import type { LegacySourceRow } from "./LegacyProfileSources.ts";
export type { LegacySourceRow as CalendarRaw } from "./LegacyProfileSources.ts";

export const LEGACY_CALENDAR_COLUMNS = ["id", "date_key", "start_time", "end_time", "duration_minutes", "client_id", "guest_name", "client_name", "appointment_type", "note", "created_at", "updated_at", "deleted_at"] as const;
export interface LegacyCalendarSnapshot {
  readonly accountScope: string;
  readonly appointments: readonly LegacySourceRow[] | null;
  /** Calendar-owned key only; other settings need separate coverage. */
  readonly plannerRows: readonly LegacySourceRow[] | null;
  readonly unsupportedAccountingTables: readonly string[];
}
