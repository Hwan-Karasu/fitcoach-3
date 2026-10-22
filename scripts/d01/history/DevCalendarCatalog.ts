/** Archived pre-baseline dev chain, for generation and historical fixture tests only. */
import type { MigrationStep } from "../../../apps/mobile/src/shared/db/MigrationRunner.ts";

export const DEV_CALENDAR_LEDGER = "calendar_schema_migrations";

/** Never NULL, so `WHEN NOT …` cannot silently pass a missing outcome. */
const outcomeMatchesLifecycle = `(CASE NEW.lifecycle
  WHEN 'SCHEDULED' THEN NEW.outcome IS NULL
  WHEN 'COMPLETED' THEN COALESCE(NEW.outcome IN ('COMPLETED','MISSED'), 0)
  ELSE NEW.outcome IS NULL OR NEW.outcome IS 'CANCELLED' END)`;

/**
 * New-install development schema in the shared dev file; requires the clients catalog first.
 * Not D01 production DDL and not a legacy Calendar import.
 */
export const devCalendarCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "k01-dev-calendar-v1-appointments-intervals-20261016",
  statements: [
    `CREATE TABLE session_types (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
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
    "CREATE UNIQUE INDEX session_types_id_workspace ON session_types(id, workspace_id)",
    `CREATE TABLE calendar_settings (
      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
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
        REFERENCES session_types(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE calendar_appointments (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
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
        REFERENCES clients(id, workspace_id) ON DELETE RESTRICT,
      FOREIGN KEY (session_type_id, workspace_id)
        REFERENCES session_types(id, workspace_id) ON DELETE RESTRICT
    )`,
    "CREATE INDEX appointments_day ON calendar_appointments(workspace_id, local_date, start_minute)",
    `CREATE INDEX appointments_client ON calendar_appointments(workspace_id, client_id)
      WHERE client_id IS NOT NULL`,
    `CREATE TABLE calendar_intervals (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK (kind IN ('DUTY','BLOCKED')),
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute % 30 = 0),
      end_minute INTEGER NOT NULL CHECK (end_minute <= 1440 AND end_minute % 30 = 0),
      created_at TEXT NOT NULL,
      CHECK (end_minute > start_minute)
    )`,
    "CREATE INDEX intervals_day ON calendar_intervals(workspace_id, local_date, start_minute)",
  ],
}, {
  version: 2,
  checksum: "l01-dev-calendar-v2-credit-bypass-20261016",
  statements: [
    "ALTER TABLE calendar_appointments ADD COLUMN credit_bypass INTEGER NOT NULL DEFAULT 0 CHECK (credit_bypass IN (0,1))",
  ],
}, {
  version: 3,
  checksum: "l02-dev-calendar-v3-appointment-outcome-20261016",
  statements: [
    // The factual outcome is separate from time and credit settlement (§48.35): SCHEDULED has none,
    // COMPLETED holds Завершена/Пропущена, CANCELLED may record «Отменена» chosen as an outcome.
    `ALTER TABLE calendar_appointments ADD COLUMN outcome TEXT
      CHECK (outcome IS NULL OR outcome IN ('COMPLETED','MISSED','CANCELLED'))`,
    "ALTER TABLE calendar_appointments ADD COLUMN outcome_at TEXT",
    // Added columns cannot carry a table CHECK, so NULL-safe triggers tie outcome to lifecycle.
    `CREATE TRIGGER appointments_outcome_insert BEFORE INSERT ON calendar_appointments
      WHEN NOT ${outcomeMatchesLifecycle}
      BEGIN SELECT RAISE(ABORT, 'CALENDAR_OUTCOME_LIFECYCLE_MISMATCH'); END`,
    `CREATE TRIGGER appointments_outcome_update
      BEFORE UPDATE OF lifecycle, outcome ON calendar_appointments
      WHEN NOT ${outcomeMatchesLifecycle}
      BEGIN SELECT RAISE(ABORT, 'CALENDAR_OUTCOME_LIFECYCLE_MISMATCH'); END`,
  ],
}, {
  version: 4,
  checksum: "l02-dev-calendar-v4-undo-cancel-prompt-20261016",
  statements: [
    `ALTER TABLE calendar_settings ADD COLUMN undo_cancel_prompt INTEGER NOT NULL DEFAULT 1
      CHECK (undo_cancel_prompt IN (0,1))`,
  ],
}, {
  version: 5,
  checksum: "k02-dev-calendar-v5-session-type-color-20261016",
  statements: [
    `ALTER TABLE session_types ADD COLUMN color TEXT
      CHECK (color IS NULL OR color IN ('teal','blue','violet','amber','rose','slate'))`,
  ],
}];
