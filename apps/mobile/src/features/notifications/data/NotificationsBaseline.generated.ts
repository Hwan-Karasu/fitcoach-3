import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

/**
 * D01: базовая миграция владельца `notifications` — итоговая схема dev-цепочки без префикса `dev_`.
 * Файл создаётся `npm run d01:baseline` (scripts/d01/generate-baseline.ts); вручную не правится. Дальнейшие изменения схемы — только
 * новые миграции версий 2, 3, … в журнале `notifications_schema_migrations`.
 */
export const notificationsBaseline: readonly MigrationStep[] = [{
  version: 1,
  checksum: "d01-baseline-notifications-4e909f10e851adbd",
  statements: [
    "CREATE TABLE notification_settings (\n      workspace_id TEXT PRIMARY KEY NOT NULL,\n      settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),\n      revision INTEGER NOT NULL CHECK (revision > 0),\n      updated_at TEXT NOT NULL\n    )",
    "CREATE TABLE notification_events (\n      id TEXT PRIMARY KEY NOT NULL,\n      workspace_id TEXT NOT NULL,\n      source_type TEXT NOT NULL CHECK (source_type IN ('APPOINTMENT','DUTY','BACKUP')),\n      source_id TEXT NOT NULL CHECK (length(source_id) > 0),\n      event_kind TEXT NOT NULL CHECK (event_kind IN ('REMINDER','OUTCOME_DUE','BACKUP_FAILED')),\n      event_version TEXT NOT NULL CHECK (length(event_version) > 0),\n      client_id TEXT,\n      title TEXT NOT NULL CHECK (length(title) > 0),\n      body TEXT NOT NULL,\n      occurs_at TEXT NOT NULL,\n      created_at TEXT NOT NULL,\n      read_at TEXT,\n      dismissed_at TEXT,\n      UNIQUE (workspace_id, source_type, source_id, event_kind, event_version),\n      FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT\n    )",
    "CREATE INDEX notification_events_feed ON notification_events(workspace_id, dismissed_at, occurs_at)",
    "CREATE TRIGGER notification_events_immutable BEFORE UPDATE ON notification_events\n      WHEN NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.source_type <> OLD.source_type OR NEW.source_id <> OLD.source_id\n        OR NEW.event_kind <> OLD.event_kind OR NEW.event_version <> OLD.event_version OR NEW.occurs_at <> OLD.occurs_at\n        OR NEW.title <> OLD.title OR NEW.body <> OLD.body OR COALESCE(NEW.client_id, '') <> COALESCE(OLD.client_id, '')\n        OR (OLD.read_at IS NOT NULL AND NEW.read_at IS NULL)\n      BEGIN SELECT RAISE(ABORT, 'NOTIFICATION_EVENT_IMMUTABLE'); END",
  ],
}];
