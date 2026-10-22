import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

/**
 * D01: базовая миграция владельца `questionnaire` — итоговая схема dev-цепочки без префикса `dev_`.
 * Файл создаётся `npm run d01:baseline` (scripts/d01/generate-baseline.ts); вручную не правится. Дальнейшие изменения схемы — только
 * новые миграции версий 2, 3, … в журнале `questionnaire_schema_migrations`.
 */
export const questionnaireBaseline: readonly MigrationStep[] = [{
  version: 1,
  checksum: "d01-baseline-questionnaire-74798075d8be27ed",
  statements: [
    "CREATE TABLE questionnaire_versions (\n      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n      version INTEGER NOT NULL CHECK (version > 0),\n      format_version INTEGER NOT NULL CHECK (format_version = 1),\n      schema_json TEXT NOT NULL CHECK (json_valid(schema_json)),\n      base_version INTEGER,\n      published_at TEXT NOT NULL,\n      PRIMARY KEY (workspace_id, version)\n    )",
    "CREATE TABLE questionnaire_drafts (\n      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n      base_version INTEGER NOT NULL,\n      revision INTEGER NOT NULL CHECK (revision > 0),\n      schema_json TEXT NOT NULL CHECK (json_valid(schema_json)),\n      updated_at TEXT NOT NULL,\n      FOREIGN KEY (workspace_id, base_version) REFERENCES questionnaire_versions(workspace_id, version)\n    )",
    "CREATE TABLE questionnaire_answers (\n      workspace_id TEXT NOT NULL,\n      client_id TEXT NOT NULL,\n      field_id TEXT NOT NULL,\n      value_json TEXT NOT NULL CHECK (json_valid(value_json)),\n      schema_version INTEGER NOT NULL,\n      updated_at TEXT NOT NULL,\n      PRIMARY KEY (workspace_id, client_id, field_id),\n      FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT\n    )",
    "CREATE TRIGGER questionnaire_versions_no_update BEFORE UPDATE ON questionnaire_versions\n      BEGIN SELECT RAISE(ABORT, 'QUESTIONNAIRE_VERSION_IMMUTABLE'); END",
    "CREATE TRIGGER questionnaire_versions_no_delete BEFORE DELETE ON questionnaire_versions\n      BEGIN SELECT RAISE(ABORT, 'QUESTIONNAIRE_VERSION_IMMUTABLE'); END",
  ],
}];
