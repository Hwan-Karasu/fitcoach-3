import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

/** New-install development schema only. D01 production DDL and legacy conversion remain gated. */
export const devClientCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "f04-dev-client-store-v1-workspace-client-20261015",
  statements: [
    `CREATE TABLE dev_workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE dev_clients (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE RESTRICT,
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
      contact_phone TEXT,
      contact_email TEXT,
      lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE','ARCHIVED')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      CHECK ((lifecycle = 'ACTIVE' AND archived_at IS NULL)
        OR (lifecycle = 'ARCHIVED' AND archived_at IS NOT NULL))
    )`,
    `CREATE INDEX dev_clients_roster ON dev_clients(workspace_id, lifecycle, display_name, id)`,
  ],
}, {
  version: 2,
  checksum: "f04-dev-client-store-v2-basic-profile-20261015",
  statements: [
    "ALTER TABLE dev_clients ADD COLUMN birth_date TEXT",
    "ALTER TABLE dev_clients ADD COLUMN height_cm_x10 INTEGER CHECK (height_cm_x10 IS NULL OR height_cm_x10 > 0)",
    "ALTER TABLE dev_clients ADD COLUMN emoji TEXT",
  ],
}, {
  version: 3,
  checksum: "f04-dev-client-store-v3-recovery-draft-20261015",
  statements: [
    "CREATE UNIQUE INDEX dev_clients_id_workspace ON dev_clients(id, workspace_id)",
    `CREATE TABLE dev_client_recovery_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE RESTRICT,
      client_id TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('create','edit')),
      base_client_revision INTEGER,
      questionnaire_revision TEXT,
      draft_schema_version INTEGER NOT NULL CHECK (draft_schema_version > 0),
      form_data_json TEXT NOT NULL CHECK (json_valid(form_data_json)),
      questionnaire_answers_json TEXT NOT NULL CHECK (json_valid(questionnaire_answers_json)),
      updated_at TEXT NOT NULL,
      CHECK ((mode = 'create' AND client_id IS NULL AND base_client_revision IS NULL)
        OR (mode = 'edit' AND client_id IS NOT NULL AND base_client_revision > 0)),
      FOREIGN KEY (client_id, workspace_id)
        REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    "CREATE UNIQUE INDEX dev_draft_create_one ON dev_client_recovery_drafts(workspace_id) WHERE mode = 'create'",
    "CREATE UNIQUE INDEX dev_draft_edit_one ON dev_client_recovery_drafts(workspace_id, client_id) WHERE mode = 'edit'",
    "CREATE INDEX dev_draft_updated ON dev_client_recovery_drafts(updated_at)",
  ],
}, {
  version: 4,
  checksum: "f04-dev-client-store-v4-roster-activity-20261015",
  statements: [
    `CREATE TABLE dev_client_activity (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      last_opened_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id),
      FOREIGN KEY (client_id, workspace_id)
        REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE dev_roster_preferences (
      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES dev_workspaces(id) ON DELETE RESTRICT,
      sort_mode TEXT NOT NULL CHECK (sort_mode IN ('NAME','RECENT'))
    )`,
    "CREATE INDEX dev_client_activity_recent ON dev_client_activity(workspace_id, last_opened_at DESC)",
  ],
}, {
  version: 5,
  checksum: "f04-dev-client-store-v5-birthday-presentation-20261015",
  statements: [
    "ALTER TABLE dev_roster_preferences ADD COLUMN birthday_pin_enabled INTEGER NOT NULL DEFAULT 1 CHECK (birthday_pin_enabled IN (0,1))",
    "ALTER TABLE dev_roster_preferences ADD COLUMN birthday_pin_lead_days INTEGER NOT NULL DEFAULT 14 CHECK (birthday_pin_lead_days BETWEEN 1 AND 60)",
    "ALTER TABLE dev_roster_preferences ADD COLUMN show_birthday_badge INTEGER NOT NULL DEFAULT 1 CHECK (show_birthday_badge IN (0,1))",
    `CREATE TABLE dev_birthday_dismissals (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      occurrence_date TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, occurrence_date),
      FOREIGN KEY (client_id, workspace_id)
        REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 6,
  checksum: "f04-dev-client-store-v6-archive-sort-20261016",
  statements: [
    "ALTER TABLE dev_roster_preferences ADD COLUMN archive_sort_mode TEXT NOT NULL DEFAULT 'ARCHIVED_AT' CHECK (archive_sort_mode IN ('ARCHIVED_AT','NAME'))",
  ],
}, {
  version: 7,
  checksum: "f04-dev-client-store-v7-sex-20261020",
  statements: [
    // Пол нужен расчёту КБЖУ; NULL = не указан (не угадывается).
    "ALTER TABLE dev_clients ADD COLUMN sex TEXT CHECK (sex IS NULL OR sex IN ('MALE','FEMALE'))",
  ],
}];
