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
}, {
  version: 2,
  checksum: "t02-dev-training-plans-v2-simple-structure-drafts-20261017",
  statements: [
    // Число недель Простой программы; у Расширенной недели живут в мезоциклах (T04).
    `ALTER TABLE dev_training_programs ADD COLUMN weeks INTEGER
      CHECK (weeks IS NULL OR weeks BETWEEN 1 AND 52)`,
    `CREATE TABLE dev_training_workouts (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
      UNIQUE (id, workspace_id),
      FOREIGN KEY (program_id, workspace_id) REFERENCES dev_training_programs(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX dev_training_workouts_program ON dev_training_workouts(workspace_id, program_id, position)`,
    // Упражнение ссылается на стабильный ID каталога; системные упражнения живут в снимке, не в таблице.
    `CREATE TABLE dev_training_planned_exercises (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      workout_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      exercise_id TEXT NOT NULL CHECK (exercise_id LIKE 'sys:%' OR exercise_id LIKE 'usr:%'),
      UNIQUE (id, workspace_id),
      FOREIGN KEY (workout_id, workspace_id) REFERENCES dev_training_workouts(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX dev_training_planned_exercises_workout ON dev_training_planned_exercises(workspace_id, workout_id, position)`,
    `CREATE TABLE dev_training_planned_sets (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      planned_exercise_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 1 AND 999),
      load_grams INTEGER CHECK (load_grams IS NULL OR load_grams BETWEEN 0 AND 1000000),
      duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
      distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
      FOREIGN KEY (planned_exercise_id, workspace_id) REFERENCES dev_training_planned_exercises(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX dev_training_planned_sets_exercise ON dev_training_planned_sets(workspace_id, planned_exercise_id, position)`,
    // §48.29 Recovery Draft конструктора: отдельно от действующего плана, по клиенту и объекту правки.
    `CREATE TABLE dev_training_builder_drafts (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      draft_key TEXT NOT NULL,
      base_revision INTEGER,
      draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, draft_key)
    )`,
  ],
}, {
  version: 3,
  checksum: "t03-dev-training-plans-v3-exercise-rest-20261017",
  statements: [
    // §48.56: отдых у каждого упражнения плана; NULL — таймер выключен. Прежние упражнения получают 90 с.
    `ALTER TABLE dev_training_planned_exercises ADD COLUMN rest_sec INTEGER DEFAULT 90
      CHECK (rest_sec IS NULL OR rest_sec BETWEEN 15 AND 900)`,
  ],
}, {
  version: 4,
  checksum: "t03-dev-training-plans-v4-rest-up-to-60-min-20261018",
  statements: [
    // Отдых 1 с – 60 мин. CHECK в SQLite не меняется на месте: упражнения и их подходы пересобираются
    // с теми же данными; подходы ссылаются на новую таблицу, после переименования связи сохраняются.
    `CREATE TABLE dev_training_planned_exercises_v4 (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      workout_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      exercise_id TEXT NOT NULL CHECK (exercise_id LIKE 'sys:%' OR exercise_id LIKE 'usr:%'),
      rest_sec INTEGER DEFAULT 90 CHECK (rest_sec IS NULL OR rest_sec BETWEEN 1 AND 3600),
      UNIQUE (id, workspace_id),
      FOREIGN KEY (workout_id, workspace_id) REFERENCES dev_training_workouts(id, workspace_id) ON DELETE RESTRICT
    )`,
    `INSERT INTO dev_training_planned_exercises_v4 (id, workspace_id, workout_id, position, exercise_id, rest_sec)
      SELECT id, workspace_id, workout_id, position, exercise_id, rest_sec FROM dev_training_planned_exercises`,
    `CREATE TABLE dev_training_planned_sets_v4 (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      planned_exercise_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 1 AND 999),
      load_grams INTEGER CHECK (load_grams IS NULL OR load_grams BETWEEN 0 AND 1000000),
      duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
      distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
      FOREIGN KEY (planned_exercise_id, workspace_id) REFERENCES dev_training_planned_exercises_v4(id, workspace_id) ON DELETE RESTRICT
    )`,
    `INSERT INTO dev_training_planned_sets_v4 (id, workspace_id, planned_exercise_id, position, reps, load_grams, duration_sec,
      distance_m) SELECT id, workspace_id, planned_exercise_id, position, reps, load_grams, duration_sec, distance_m
      FROM dev_training_planned_sets`,
    `DROP TABLE dev_training_planned_sets`,
    `DROP TABLE dev_training_planned_exercises`,
    `ALTER TABLE dev_training_planned_exercises_v4 RENAME TO dev_training_planned_exercises`,
    `ALTER TABLE dev_training_planned_sets_v4 RENAME TO dev_training_planned_sets`,
    `CREATE INDEX dev_training_planned_exercises_workout ON dev_training_planned_exercises(workspace_id, workout_id, position)`,
    `CREATE INDEX dev_training_planned_sets_exercise ON dev_training_planned_sets(workspace_id, planned_exercise_id, position)`,
  ],
}];
