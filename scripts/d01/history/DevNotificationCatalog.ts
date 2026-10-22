/** Archived pre-baseline dev chain, for generation and historical fixture tests only. */
import type { MigrationStep } from "../../../apps/mobile/src/shared/db/MigrationRunner.ts";

export const DEV_NOTIFICATION_LEDGER = "notifications_schema_migrations";

/** Dev-схема уведомлений в общем dev-файле (после Clients); не production DDL (D01). */
export const devNotificationCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "u02-dev-notifications-v1-settings-center-events-20261022",
  statements: [
    `CREATE TABLE notification_settings (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL
    )`,
    // Identity события — (workspace, source_type, source_id, event_kind, event_version): повтор не создаёт дубль (§54.5 п.1).
    `CREATE TABLE notification_events (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('APPOINTMENT','DUTY','BACKUP')),
      source_id TEXT NOT NULL CHECK (length(source_id) > 0),
      event_kind TEXT NOT NULL CHECK (event_kind IN ('REMINDER','OUTCOME_DUE','BACKUP_FAILED')),
      event_version TEXT NOT NULL CHECK (length(event_version) > 0),
      client_id TEXT,
      title TEXT NOT NULL CHECK (length(title) > 0),
      body TEXT NOT NULL,
      occurs_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      dismissed_at TEXT,
      UNIQUE (workspace_id, source_type, source_id, event_kind, event_version),
      FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    "CREATE INDEX notification_events_feed ON notification_events(workspace_id, dismissed_at, occurs_at)",
    // Статус монотонен: прочитанное не становится непрочитанным, убранное возвращает только явное «Отменить».
    `CREATE TRIGGER notification_events_immutable BEFORE UPDATE ON notification_events
      WHEN NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.source_type <> OLD.source_type OR NEW.source_id <> OLD.source_id
        OR NEW.event_kind <> OLD.event_kind OR NEW.event_version <> OLD.event_version OR NEW.occurs_at <> OLD.occurs_at
        OR NEW.title <> OLD.title OR NEW.body <> OLD.body OR COALESCE(NEW.client_id, '') <> COALESCE(OLD.client_id, '')
        OR (OLD.read_at IS NOT NULL AND NEW.read_at IS NULL)
      BEGIN SELECT RAISE(ABORT, 'NOTIFICATION_EVENT_IMMUTABLE'); END`,
  ],
}];
