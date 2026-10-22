import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

/**
 * D01: базовая миграция владельца `clients` — итоговая схема dev-цепочки без префикса `dev_`.
 * Файл создаётся `npm run d01:baseline` (scripts/d01/generate-baseline.ts); вручную не правится. Дальнейшие изменения схемы — только
 * новые миграции версий 2, 3, … в журнале `clients_schema_migrations`.
 */
export const clientsBaseline: readonly MigrationStep[] = [{
  version: 1,
  checksum: "d01-baseline-clients-8dc3e654357835c6",
  statements: [
    "CREATE TABLE workspaces (\n      id TEXT PRIMARY KEY NOT NULL,\n      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),\n      created_at TEXT NOT NULL\n    )",
    "CREATE TABLE clients (\n      id TEXT PRIMARY KEY NOT NULL,\n      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),\n      contact_phone TEXT,\n      contact_email TEXT,\n      lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE','ARCHIVED')),\n      revision INTEGER NOT NULL CHECK (revision > 0),\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL,\n      archived_at TEXT, birth_date TEXT, height_cm_x10 INTEGER CHECK (height_cm_x10 IS NULL OR height_cm_x10 > 0), emoji TEXT, sex TEXT CHECK (sex IS NULL OR sex IN ('MALE','FEMALE')),\n      CHECK ((lifecycle = 'ACTIVE' AND archived_at IS NULL)\n        OR (lifecycle = 'ARCHIVED' AND archived_at IS NOT NULL))\n    )",
    "CREATE TABLE client_recovery_drafts (\n      id TEXT PRIMARY KEY NOT NULL,\n      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n      client_id TEXT,\n      mode TEXT NOT NULL CHECK (mode IN ('create','edit')),\n      base_client_revision INTEGER,\n      questionnaire_revision TEXT,\n      draft_schema_version INTEGER NOT NULL CHECK (draft_schema_version > 0),\n      form_data_json TEXT NOT NULL CHECK (json_valid(form_data_json)),\n      questionnaire_answers_json TEXT NOT NULL CHECK (json_valid(questionnaire_answers_json)),\n      updated_at TEXT NOT NULL,\n      CHECK ((mode = 'create' AND client_id IS NULL AND base_client_revision IS NULL)\n        OR (mode = 'edit' AND client_id IS NOT NULL AND base_client_revision > 0)),\n      FOREIGN KEY (client_id, workspace_id)\n        REFERENCES clients(id, workspace_id) ON DELETE RESTRICT\n    )",
    "CREATE TABLE client_activity (\n      workspace_id TEXT NOT NULL,\n      client_id TEXT NOT NULL,\n      last_opened_at TEXT NOT NULL,\n      PRIMARY KEY (workspace_id, client_id),\n      FOREIGN KEY (client_id, workspace_id)\n        REFERENCES clients(id, workspace_id) ON DELETE RESTRICT\n    )",
    "CREATE TABLE roster_preferences (\n      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n      sort_mode TEXT NOT NULL CHECK (sort_mode IN ('NAME','RECENT'))\n    , birthday_pin_enabled INTEGER NOT NULL DEFAULT 1 CHECK (birthday_pin_enabled IN (0,1)), birthday_pin_lead_days INTEGER NOT NULL DEFAULT 14 CHECK (birthday_pin_lead_days BETWEEN 1 AND 60), show_birthday_badge INTEGER NOT NULL DEFAULT 1 CHECK (show_birthday_badge IN (0,1)), archive_sort_mode TEXT NOT NULL DEFAULT 'ARCHIVED_AT' CHECK (archive_sort_mode IN ('ARCHIVED_AT','NAME')))",
    "CREATE TABLE birthday_dismissals (\n      workspace_id TEXT NOT NULL,\n      client_id TEXT NOT NULL,\n      occurrence_date TEXT NOT NULL,\n      PRIMARY KEY (workspace_id, client_id, occurrence_date),\n      FOREIGN KEY (client_id, workspace_id)\n        REFERENCES clients(id, workspace_id) ON DELETE RESTRICT\n    )",
    "CREATE INDEX clients_roster ON clients(workspace_id, lifecycle, display_name, id)",
    "CREATE UNIQUE INDEX clients_id_workspace ON clients(id, workspace_id)",
    "CREATE UNIQUE INDEX draft_create_one ON client_recovery_drafts(workspace_id) WHERE mode = 'create'",
    "CREATE UNIQUE INDEX draft_edit_one ON client_recovery_drafts(workspace_id, client_id) WHERE mode = 'edit'",
    "CREATE INDEX draft_updated ON client_recovery_drafts(updated_at)",
    "CREATE INDEX client_activity_recent ON client_activity(workspace_id, last_opened_at DESC)",
  ],
}];
