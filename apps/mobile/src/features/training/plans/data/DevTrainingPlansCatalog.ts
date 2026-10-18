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
}, {
  version: 5,
  checksum: "t03-dev-training-plans-v5-exercise-instruction-20261018",
  statements: [
    // §48.67: плановое указание упражнения (часть плана, копируется с ним); фактические заметки — в дневнике.
    `ALTER TABLE dev_training_planned_exercises ADD COLUMN instruction TEXT
      CHECK (instruction IS NULL OR length(trim(instruction)) BETWEEN 1 AND 500)`,
  ],
}, {
  version: 6,
  checksum: "t02-dev-training-plans-v6-rep-ranges-rir-20261018",
  statements: [
    // Как в 2.0: повторы «8–12» (верхняя граница) и плановый RIR «1–2» у упражнения.
    `ALTER TABLE dev_training_planned_sets ADD COLUMN reps_max INTEGER
      CHECK (reps_max IS NULL OR (reps IS NOT NULL AND reps_max > reps AND reps_max <= 999))`,
    `ALTER TABLE dev_training_planned_exercises ADD COLUMN rir_min INTEGER CHECK (rir_min IS NULL OR rir_min BETWEEN 0 AND 10)`,
    `ALTER TABLE dev_training_planned_exercises ADD COLUMN rir_max INTEGER
      CHECK (rir_max IS NULL OR (rir_min IS NOT NULL AND rir_max > rir_min AND rir_max <= 10))`,
  ],
}, {
  version: 7,
  checksum: "t04-dev-training-plans-v7-mesocycles-weeks-lineage-20261018",
  statements: [
    // §48.3, §48.28: мезоцикл — у каждого участника свой; копии одного мезоцикла связаны родством.
    `CREATE TABLE dev_training_mesocycles (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      lineage_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
      created_at TEXT NOT NULL,
      UNIQUE (id, workspace_id),
      UNIQUE (workspace_id, program_id, client_id, lineage_id),
      FOREIGN KEY (workspace_id, program_id, client_id)
        REFERENCES dev_training_program_members(workspace_id, program_id, client_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX dev_training_mesocycles_member ON dev_training_mesocycles(workspace_id, program_id, client_id, position)`,
    // Мезоциклы — только у Расширенной программы (§48.3 п. 7).
    `CREATE TRIGGER dev_training_mesocycles_periodized BEFORE INSERT ON dev_training_mesocycles
      WHEN COALESCE((SELECT kind FROM dev_training_programs WHERE id = NEW.program_id AND workspace_id = NEW.workspace_id), '')
        <> 'PERIODIZED'
      BEGIN SELECT RAISE(ABORT, 'DRAFT_INVALID'); END`,
    // Тип недели — как в FitCoach 2.0 (решение владельца 2026-10-18).
    `CREATE TABLE dev_training_weeks (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      mesocycle_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 51),
      week_type TEXT NOT NULL CHECK (week_type IN ('base','light','medium','heavy','deload')),
      UNIQUE (id, workspace_id),
      UNIQUE (workspace_id, mesocycle_id, position),
      FOREIGN KEY (mesocycle_id, workspace_id) REFERENCES dev_training_mesocycles(id, workspace_id) ON DELETE RESTRICT
    )`,
    // Тренировка Расширенной программы принадлежит неделе; у Простой недели нет.
    `ALTER TABLE dev_training_workouts ADD COLUMN week_id TEXT REFERENCES dev_training_weeks(id) ON DELETE RESTRICT`,
    `ALTER TABLE dev_training_workouts ADD COLUMN lineage_id TEXT`,
    `ALTER TABLE dev_training_planned_exercises ADD COLUMN lineage_id TEXT`,
    `CREATE INDEX dev_training_workouts_week ON dev_training_workouts(workspace_id, week_id, position)`,
    // Неделя — той же программы, что и тренировка; у Расширенной тренировки неделя обязательна, у Простой — нет.
    `CREATE TRIGGER dev_training_workouts_week_insert BEFORE INSERT ON dev_training_workouts
      WHEN (NEW.week_id IS NULL) <> (COALESCE((SELECT kind FROM dev_training_programs
          WHERE id = NEW.program_id AND workspace_id = NEW.workspace_id), '') <> 'PERIODIZED')
        OR (NEW.week_id IS NOT NULL AND COALESCE((SELECT m.program_id FROM dev_training_weeks w
          JOIN dev_training_mesocycles m ON m.id = w.mesocycle_id AND m.workspace_id = w.workspace_id
          WHERE w.id = NEW.week_id AND w.workspace_id = NEW.workspace_id), '') <> NEW.program_id)
      BEGIN SELECT RAISE(ABORT, 'DRAFT_INVALID'); END`,
    `CREATE TRIGGER dev_training_workouts_week_fixed BEFORE UPDATE OF week_id, program_id ON dev_training_workouts
      WHEN NEW.week_id IS NOT OLD.week_id OR NEW.program_id IS NOT OLD.program_id
      BEGIN SELECT RAISE(ABORT, 'DRAFT_INVALID'); END`,
    // §48.10 п. 6: выбранный мезоцикл — у пары клиент/программа, только из своих мезоциклов.
    `CREATE TABLE dev_training_mesocycle_selection (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      mesocycle_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, program_id),
      FOREIGN KEY (mesocycle_id, workspace_id) REFERENCES dev_training_mesocycles(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE TRIGGER dev_training_mesocycle_selection_own_insert BEFORE INSERT ON dev_training_mesocycle_selection
      WHEN NOT EXISTS (SELECT 1 FROM dev_training_mesocycles WHERE id = NEW.mesocycle_id AND workspace_id = NEW.workspace_id
        AND program_id = NEW.program_id AND client_id = NEW.client_id)
      BEGIN SELECT RAISE(ABORT, 'TARGET_NOT_FOUND'); END`,
    `CREATE TRIGGER dev_training_mesocycle_selection_own_update BEFORE UPDATE ON dev_training_mesocycle_selection
      WHEN NOT EXISTS (SELECT 1 FROM dev_training_mesocycles WHERE id = NEW.mesocycle_id AND workspace_id = NEW.workspace_id
        AND program_id = NEW.program_id AND client_id = NEW.client_id)
      BEGIN SELECT RAISE(ABORT, 'TARGET_NOT_FOUND'); END`,
  ],
}, {
  version: 8,
  checksum: "t04-dev-training-plans-v8-library-order-20261018",
  statements: [
    // Порядок программ в библиотеке — свой у каждого клиента (перетаскивание); NULL — ещё не упорядочена (сверху).
    `ALTER TABLE dev_training_program_members ADD COLUMN sort_position INTEGER
      CHECK (sort_position IS NULL OR sort_position >= 0)`,
  ],
}, {
  version: 9,
  checksum: "t04-dev-training-plans-v9-periodized-drafts-20261018",
  statements: [
    `CREATE TABLE dev_training_periodized_drafts (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      draft_key TEXT NOT NULL,
      draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, client_id, program_id, draft_key),
      FOREIGN KEY(workspace_id, program_id, client_id)
        REFERENCES dev_training_program_members(workspace_id, program_id, client_id) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 10,
  checksum: "t04-dev-training-plans-v10-cycle-versions-20261018",
  statements: [
    `CREATE TABLE dev_training_structure_versions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      mesocycle_id TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT NOT NULL CHECK(valid_to >= valid_from),
      structure_json TEXT NOT NULL CHECK(CASE WHEN json_valid(structure_json)
        THEN json_type(structure_json) = 'object' ELSE 0 END),
      FOREIGN KEY(workspace_id, program_id, client_id)
        REFERENCES dev_training_program_members(workspace_id, program_id, client_id) ON DELETE RESTRICT,
      FOREIGN KEY(mesocycle_id, workspace_id) REFERENCES dev_training_mesocycles(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX dev_training_structure_versions_scope
      ON dev_training_structure_versions(workspace_id, client_id, program_id, mesocycle_id)`,
    `CREATE TRIGGER dev_training_structure_versions_immutable BEFORE UPDATE ON dev_training_structure_versions
      BEGIN SELECT RAISE(ABORT, 'STRUCTURE_VERSION_IMMUTABLE'); END`,
    `CREATE TRIGGER dev_training_structure_versions_owner BEFORE INSERT ON dev_training_structure_versions
      WHEN NOT EXISTS (SELECT 1 FROM dev_training_mesocycles WHERE id = NEW.mesocycle_id
        AND workspace_id = NEW.workspace_id AND client_id = NEW.client_id AND program_id = NEW.program_id)
      BEGIN SELECT RAISE(ABORT, 'TARGET_NOT_FOUND'); END`,
  ],
}, {
  version: 11,
  checksum: "t04-dev-training-plans-v11-supersets-20261018",
  statements: [
    `ALTER TABLE dev_training_planned_exercises ADD COLUMN superset_id TEXT
      CHECK(superset_id IS NULL OR length(trim(superset_id)) > 0)`,
  ],
}, {
  version: 12,
  checksum: "t02-dev-training-plans-v12-simple-workout-overrides-versions-20261018",
  statements: [
    `CREATE TABLE dev_training_simple_overrides (
      workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, program_id TEXT NOT NULL,
      week_index INTEGER NOT NULL CHECK(week_index BETWEEN 1 AND 52), workout_id TEXT NOT NULL,
      workout_json TEXT NOT NULL CHECK(CASE WHEN json_valid(workout_json)
        THEN COALESCE(json_extract(workout_json, '$.id') = workout_id, 0) ELSE 0 END),
      PRIMARY KEY(workspace_id, client_id, program_id, week_index, workout_id),
      FOREIGN KEY(workspace_id, program_id, client_id)
        REFERENCES dev_training_program_members(workspace_id, program_id, client_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE dev_training_simple_versions (
      id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, program_id TEXT NOT NULL,
      valid_from TEXT NOT NULL, valid_to TEXT NOT NULL CHECK(valid_to >= valid_from),
      structure_json TEXT NOT NULL CHECK(CASE WHEN json_valid(structure_json)
        THEN json_type(structure_json) = 'object' ELSE 0 END),
      FOREIGN KEY(workspace_id, program_id, client_id)
        REFERENCES dev_training_program_members(workspace_id, program_id, client_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX dev_training_simple_versions_scope ON dev_training_simple_versions(workspace_id, client_id, program_id)`,
    `CREATE TRIGGER dev_training_simple_versions_immutable BEFORE UPDATE ON dev_training_simple_versions
      BEGIN SELECT RAISE(ABORT, 'STRUCTURE_VERSION_IMMUTABLE'); END`,
    ...["INSERT", "UPDATE"].map((operation) => `CREATE TRIGGER dev_training_simple_overrides_${operation.toLowerCase()}
      BEFORE ${operation} ON dev_training_simple_overrides WHEN NOT EXISTS
      (SELECT 1 FROM dev_training_programs p JOIN dev_training_workouts w ON w.program_id = p.id AND w.workspace_id = p.workspace_id
        WHERE p.workspace_id = NEW.workspace_id AND p.id = NEW.program_id AND p.kind = 'SIMPLE'
          AND w.id = NEW.workout_id AND NEW.week_index <= p.weeks)
      BEGIN SELECT RAISE(ABORT, 'DRAFT_INVALID'); END`),
  ],
}, {
  version: 13,
  checksum: "t04-dev-training-plans-v13-template-library-20261018",
  statements: [
    // §48.14–48.16: одна библиотека шаблонов тренера, три типа. Только план (JSON-снимок): на шаблон не ссылаются
    // факты, при применении все ID создаются заново. Клиентских данных и участников в шаблоне нет.
    `CREATE TABLE dev_training_templates (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('SIMPLE','PERIODIZED','MESOCYCLE')),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
      payload_json TEXT NOT NULL CHECK (CASE WHEN json_valid(payload_json)
        THEN COALESCE(json_extract(payload_json, '$.kind') = kind, 0) ELSE 0 END),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX dev_training_templates_workspace ON dev_training_templates(workspace_id, kind, title)`,
  ],
}];
