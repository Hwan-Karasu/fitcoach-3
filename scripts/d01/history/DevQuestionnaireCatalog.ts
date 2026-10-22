/** Archived pre-baseline dev chain, for generation and historical fixture tests only. */
import type { MigrationStep } from "../../../apps/mobile/src/shared/db/MigrationRunner.ts";

export const DEV_QUESTIONNAIRE_LEDGER = "questionnaire_schema_migrations";

/**
 * New-install development schema in the shared dev file; requires the clients catalog first.
 * Not D01 production DDL and not a build120 questionnaire import.
 */
export const devQuestionnaireCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "q01-dev-questionnaire-v1-versions-draft-answers-20261016",
  statements: [
    // §25.1: a published snapshot is immutable; the triggers make that a storage fact.
    `CREATE TABLE questionnaire_versions (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL CHECK (version > 0),
      format_version INTEGER NOT NULL CHECK (format_version = 1),
      schema_json TEXT NOT NULL CHECK (json_valid(schema_json)),
      base_version INTEGER,
      published_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, version)
    )`,
    `CREATE TRIGGER questionnaire_versions_no_update BEFORE UPDATE ON questionnaire_versions
      BEGIN SELECT RAISE(ABORT, 'QUESTIONNAIRE_VERSION_IMMUTABLE'); END`,
    `CREATE TRIGGER questionnaire_versions_no_delete BEFORE DELETE ON questionnaire_versions
      BEGIN SELECT RAISE(ABORT, 'QUESTIONNAIRE_VERSION_IMMUTABLE'); END`,
    // §25.2: exactly one working draft per workspace.
    `CREATE TABLE questionnaire_drafts (
      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
      base_version INTEGER NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      schema_json TEXT NOT NULL CHECK (json_valid(schema_json)),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id, base_version) REFERENCES questionnaire_versions(workspace_id, version)
    )`,
    // §25.7: one answer per stable field ID, never a copy per schema version.
    `CREATE TABLE questionnaire_answers (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      schema_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, field_id),
      FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT
    )`,
  ],
}];
