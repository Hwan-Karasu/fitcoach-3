import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

export const DEV_CALENDAR_LEDGER = "calendar_schema_migrations";

/**
 * New-install development schema in the shared dev file; requires the clients catalog first.
 * Not D01 production DDL and not a legacy Calendar import.
 */
export const devCalendarCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "k01-dev-calendar-v1-appointments-intervals-20261016",
  statements: [
    `CREATE TABLE dev_session_types (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE RESTRICT,
      seed_key TEXT,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      category TEXT NOT NULL CHECK (category IN ('TRAINING','INSTRUCTION','CONSULTATION','OTHER')),
      default_duration_minutes INTEGER NOT NULL
        CHECK (default_duration_minutes > 0 AND default_duration_minutes % 30 = 0),
      requires_credit INTEGER NOT NULL CHECK (requires_credit IN (0,1)),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, seed_key)
    )`,
    "CREATE UNIQUE INDEX dev_session_types_id_workspace ON dev_session_types(id, workspace_id)",
    `CREATE TABLE dev_calendar_settings (
      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES dev_workspaces(id) ON DELETE RESTRICT,
      day_start_minute INTEGER NOT NULL DEFAULT 420
        CHECK (day_start_minute >= 0 AND day_start_minute % 30 = 0),
      day_end_minute INTEGER NOT NULL DEFAULT 1380
        CHECK (day_end_minute <= 1440 AND day_end_minute % 30 = 0),
      visible_weekdays TEXT NOT NULL DEFAULT '1111111'
        CHECK (length(visible_weekdays) = 7 AND visible_weekdays NOT GLOB '*[^01]*'
          AND instr(visible_weekdays, '1') > 0),
      default_session_type_id TEXT,
      copy_appointments INTEGER NOT NULL DEFAULT 1 CHECK (copy_appointments IN (0,1)),
      copy_duty INTEGER NOT NULL DEFAULT 1 CHECK (copy_duty IN (0,1)),
      copy_blocked INTEGER NOT NULL DEFAULT 1 CHECK (copy_blocked IN (0,1)),
      clear_appointments INTEGER NOT NULL DEFAULT 1 CHECK (clear_appointments IN (0,1)),
      clear_duty INTEGER NOT NULL DEFAULT 1 CHECK (clear_duty IN (0,1)),
      clear_blocked INTEGER NOT NULL DEFAULT 1 CHECK (clear_blocked IN (0,1)),
      CHECK (day_end_minute - day_start_minute >= 30),
      FOREIGN KEY (default_session_type_id, workspace_id)
        REFERENCES dev_session_types(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE dev_calendar_appointments (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE RESTRICT,
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute % 30 = 0),
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes % 30 = 0),
      client_id TEXT,
      guest_name TEXT,
      participant_deleted INTEGER NOT NULL DEFAULT 0 CHECK (participant_deleted IN (0,1)),
      session_type_id TEXT NOT NULL,
      session_type_name TEXT NOT NULL,
      session_type_category TEXT NOT NULL,
      session_type_requires_credit INTEGER NOT NULL CHECK (session_type_requires_credit IN (0,1)),
      note TEXT,
      lifecycle TEXT NOT NULL CHECK (lifecycle IN ('SCHEDULED','COMPLETED','CANCELLED')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cancelled_at TEXT,
      CHECK (start_minute + duration_minutes <= 1440),
      CHECK ((client_id IS NOT NULL AND guest_name IS NULL AND participant_deleted = 0)
        OR (client_id IS NULL AND guest_name IS NOT NULL AND length(trim(guest_name)) > 0
          AND participant_deleted = 0)
        OR (client_id IS NULL AND guest_name IS NULL AND participant_deleted = 1)),
      CHECK ((lifecycle = 'CANCELLED') = (cancelled_at IS NOT NULL)),
      FOREIGN KEY (client_id, workspace_id)
        REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT,
      FOREIGN KEY (session_type_id, workspace_id)
        REFERENCES dev_session_types(id, workspace_id) ON DELETE RESTRICT
    )`,
    "CREATE INDEX dev_appointments_day ON dev_calendar_appointments(workspace_id, local_date, start_minute)",
    `CREATE INDEX dev_appointments_client ON dev_calendar_appointments(workspace_id, client_id)
      WHERE client_id IS NOT NULL`,
    `CREATE TABLE dev_calendar_intervals (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK (kind IN ('DUTY','BLOCKED')),
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute % 30 = 0),
      end_minute INTEGER NOT NULL CHECK (end_minute <= 1440 AND end_minute % 30 = 0),
      created_at TEXT NOT NULL,
      CHECK (end_minute > start_minute)
    )`,
    "CREATE INDEX dev_intervals_day ON dev_calendar_intervals(workspace_id, local_date, start_minute)",
  ],
}];
