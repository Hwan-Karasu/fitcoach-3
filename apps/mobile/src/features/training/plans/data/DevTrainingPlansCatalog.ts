import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";

export const DEV_TRAINING_PLANS_LEDGER = "training_plans_schema_migrations";

/**
 * Dev-схема библиотеки программ в общем dev-файле; требует каталог клиентов. Не production DDL (D01/D02)
 * и не импорт build120. Структура программы (мезоциклы, недели, упражнения) — T02/T04.
 */
export const devTrainingPlansCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "t01-dev-training-plans-v1-programs-members-selection-20261017",
  statements: [
    `CREATE TABLE dev_training_programs (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('SIMPLE','PERIODIZED')),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, workspace_id)
    )`,
    // Тип программы задаётся при создании: другой конструктор — другая программа (§48.2).
    `CREATE TRIGGER dev_training_programs_kind_fixed BEFORE UPDATE OF kind ON dev_training_programs
      WHEN NEW.kind IS NOT OLD.kind
      BEGIN SELECT RAISE(ABORT, 'DRAFT_INVALID'); END`,
    // Участие клиента; архив — у участия, поэтому у остальных участников программа остаётся.
    `CREATE TABLE dev_training_program_members (
      workspace_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      archived_at TEXT,
      PRIMARY KEY (workspace_id, program_id, client_id),
      FOREIGN KEY (program_id, workspace_id) REFERENCES dev_training_programs(id, workspace_id) ON DELETE RESTRICT,
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX dev_training_members_client ON dev_training_program_members(workspace_id, client_id)`,
    // Простая программа — ровно один клиент (§48.2.5).
    `CREATE TRIGGER dev_training_simple_single_member BEFORE INSERT ON dev_training_program_members
      WHEN COALESCE((SELECT kind FROM dev_training_programs
          WHERE id = NEW.program_id AND workspace_id = NEW.workspace_id), '') = 'SIMPLE'
        AND EXISTS (SELECT 1 FROM dev_training_program_members
          WHERE workspace_id = NEW.workspace_id AND program_id = NEW.program_id)
      BEGIN SELECT RAISE(ABORT, 'PARTICIPANT_CONFLICT'); END`,
    // Выбранная программа клиента — только из его же участий (составной FK), и не из архива.
    `CREATE TABLE dev_training_client_selection (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id),
      FOREIGN KEY (workspace_id, program_id, client_id)
        REFERENCES dev_training_program_members(workspace_id, program_id, client_id) ON DELETE RESTRICT
    )`,
    `CREATE TRIGGER dev_training_selection_active_insert BEFORE INSERT ON dev_training_client_selection
      WHEN COALESCE((SELECT archived_at IS NOT NULL FROM dev_training_program_members
          WHERE workspace_id = NEW.workspace_id AND program_id = NEW.program_id AND client_id = NEW.client_id), 0) = 1
      BEGIN SELECT RAISE(ABORT, 'PROGRAM_ARCHIVED'); END`,
    `CREATE TRIGGER dev_training_selection_active_update BEFORE UPDATE ON dev_training_client_selection
      WHEN COALESCE((SELECT archived_at IS NOT NULL FROM dev_training_program_members
          WHERE workspace_id = NEW.workspace_id AND program_id = NEW.program_id AND client_id = NEW.client_id), 0) = 1
      BEGIN SELECT RAISE(ABORT, 'PROGRAM_ARCHIVED'); END`,
    // Выбранную программу нельзя увести в архив, не сняв выбор в той же транзакции.
    `CREATE TRIGGER dev_training_member_archive_unselected BEFORE UPDATE OF archived_at ON dev_training_program_members
      WHEN NEW.archived_at IS NOT NULL AND EXISTS (SELECT 1 FROM dev_training_client_selection
        WHERE workspace_id = NEW.workspace_id AND client_id = NEW.client_id AND program_id = NEW.program_id)
      BEGIN SELECT RAISE(ABORT, 'PROGRAM_SELECTED'); END`,
  ],
}];
