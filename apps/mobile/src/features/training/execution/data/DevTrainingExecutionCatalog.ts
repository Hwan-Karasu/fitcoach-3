import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";

export const DEV_TRAINING_EXECUTION_LEDGER = "training_execution_schema_migrations";

/**
 * Dev-схема дневника тренировок в общем dev-файле; требует каталог клиентов. Не production DDL (D01/D02)
 * и не импорт build120. План — другой владелец: слот и подход хранятся как ссылки без FK, поэтому
 * правка структуры плана не стирает факты (§48.5.7, TX-02).
 */
export const devTrainingExecutionCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "t03-dev-training-execution-v1-sessions-sets-settings-20261017",
  statements: [
    // Общая настройка тренера (§48.54); отсутствие строки — режим по умолчанию.
    `CREATE TABLE dev_training_execution_settings (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      confirmation_mode TEXT NOT NULL CHECK (confirmation_mode IN ('AUTO','MANUAL'))
    )`,
    // Одно выполнение на плановый слот недели клиента (§48.33).
    `CREATE TABLE dev_training_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      week_index INTEGER NOT NULL CHECK (week_index BETWEEN 1 AND 52),
      planned_workout_id TEXT NOT NULL,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('COMPLETED','MISSED','CANCELLED')),
      actual_date TEXT NOT NULL CHECK (actual_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, workspace_id),
      UNIQUE (workspace_id, client_id, program_id, week_index, planned_workout_id),
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE TRIGGER dev_training_sessions_slot_fixed BEFORE UPDATE OF client_id, program_id, week_index,
        planned_workout_id ON dev_training_sessions
      WHEN NEW.client_id IS NOT OLD.client_id OR NEW.program_id IS NOT OLD.program_id
        OR NEW.week_index IS NOT OLD.week_index OR NEW.planned_workout_id IS NOT OLD.planned_workout_id
      BEGIN SELECT RAISE(ABORT, 'WRONG_CLIENT_SCOPE'); END`,
    // Факт подхода: одна строка на плановый подход выполнения; подтверждение без значения невозможно.
    // origin — происхождение подтверждения (§48.44 п. 6): ввод в дневнике, копирование, импорт.
    `CREATE TABLE dev_training_performed_sets (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      planned_set_id TEXT NOT NULL,
      planned_exercise_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL CHECK (exercise_id LIKE 'sys:%' OR exercise_id LIKE 'usr:%'),
      position INTEGER NOT NULL CHECK (position >= 0),
      set_type TEXT NOT NULL CHECK (set_type IN ('NORMAL','WARMUP','FAILURE')),
      reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 1 AND 999),
      load_grams INTEGER CHECK (load_grams IS NULL OR load_grams BETWEEN 0 AND 1000000),
      duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
      distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
      rpe INTEGER CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
      confirmed_at TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('INPUT','COPY','IMPORT')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL,
      CHECK (CASE WHEN confirmed_at IS NULL THEN 1
        ELSE COALESCE(reps, load_grams, duration_sec, distance_m) IS NOT NULL END),
      UNIQUE (workspace_id, session_id, planned_set_id),
      FOREIGN KEY (session_id, workspace_id) REFERENCES dev_training_sessions(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE TRIGGER dev_training_performed_sets_identity_fixed BEFORE UPDATE OF session_id, planned_set_id,
        exercise_id ON dev_training_performed_sets
      WHEN NEW.session_id IS NOT OLD.session_id OR NEW.planned_set_id IS NOT OLD.planned_set_id
        OR NEW.exercise_id IS NOT OLD.exercise_id
      BEGIN SELECT RAISE(ABORT, 'FACT_IDENTITY_FIXED'); END`,
    `CREATE INDEX dev_training_performed_sets_exercise ON dev_training_performed_sets(workspace_id, exercise_id)`,
  ],
}, {
  version: 2,
  checksum: "t03-dev-training-execution-v2-drop-sets-20261017",
  statements: [
    // Тип DROP (§48.60): CHECK в SQLite не меняется на месте — таблица пересобирается с теми же данными.
    `CREATE TABLE dev_training_performed_sets_v2 (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      planned_set_id TEXT NOT NULL,
      planned_exercise_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL CHECK (exercise_id LIKE 'sys:%' OR exercise_id LIKE 'usr:%'),
      position INTEGER NOT NULL CHECK (position >= 0),
      set_type TEXT NOT NULL CHECK (set_type IN ('NORMAL','WARMUP','FAILURE','DROP')),
      reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 1 AND 999),
      load_grams INTEGER CHECK (load_grams IS NULL OR load_grams BETWEEN 0 AND 1000000),
      duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
      distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
      rpe INTEGER CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
      confirmed_at TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('INPUT','COPY','IMPORT')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL,
      CHECK (CASE WHEN confirmed_at IS NULL THEN 1
        ELSE COALESCE(reps, load_grams, duration_sec, distance_m) IS NOT NULL END),
      UNIQUE (workspace_id, session_id, planned_set_id),
      FOREIGN KEY (session_id, workspace_id) REFERENCES dev_training_sessions(id, workspace_id) ON DELETE RESTRICT
    )`,
    `INSERT INTO dev_training_performed_sets_v2 (id, workspace_id, session_id, planned_set_id, planned_exercise_id,
      exercise_id, position, set_type, reps, load_grams, duration_sec, distance_m, rpe, confirmed_at, origin, revision,
      updated_at) SELECT id, workspace_id, session_id, planned_set_id, planned_exercise_id, exercise_id, position,
      set_type, reps, load_grams, duration_sec, distance_m, rpe, confirmed_at, origin, revision, updated_at
      FROM dev_training_performed_sets`,
    `DROP TABLE dev_training_performed_sets`,
    `ALTER TABLE dev_training_performed_sets_v2 RENAME TO dev_training_performed_sets`,
    `CREATE TRIGGER dev_training_performed_sets_identity_fixed BEFORE UPDATE OF session_id, planned_set_id,
        exercise_id ON dev_training_performed_sets
      WHEN NEW.session_id IS NOT OLD.session_id OR NEW.planned_set_id IS NOT OLD.planned_set_id
        OR NEW.exercise_id IS NOT OLD.exercise_id
      BEGIN SELECT RAISE(ABORT, 'FACT_IDENTITY_FIXED'); END`,
    `CREATE INDEX dev_training_performed_sets_exercise ON dev_training_performed_sets(workspace_id, exercise_id)`,
    // Мини-сеты дроп-сета после основного (основной — в строке подхода); номер 2..10 по порядку.
    `CREATE TABLE dev_training_performed_drops (
      workspace_id TEXT NOT NULL,
      set_id TEXT NOT NULL REFERENCES dev_training_performed_sets(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position BETWEEN 2 AND 10),
      reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 1 AND 999),
      load_grams INTEGER CHECK (load_grams IS NULL OR load_grams BETWEEN 0 AND 1000000),
      duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
      distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
      PRIMARY KEY (workspace_id, set_id, position)
    )`,
    // Мини-сеты есть только у дроп-сета.
    `CREATE TRIGGER dev_training_performed_drops_only_drop BEFORE INSERT ON dev_training_performed_drops
      WHEN COALESCE((SELECT set_type FROM dev_training_performed_sets WHERE id = NEW.set_id), '') <> 'DROP'
      BEGIN SELECT RAISE(ABORT, 'INVALID_METRIC'); END`,
  ],
}, {
  version: 3,
  checksum: "t03-dev-training-execution-v3-rest-timers-20261017",
  statements: [
    // §44.7: минимальное состояние таймеров отдыха для восстановления; это не тренировочный факт (§44.8).
    `CREATE TABLE dev_training_rest_timers (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      exercise_key TEXT NOT NULL,
      exercise_name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL CHECK (end_at >= started_at),
      signal_id TEXT,
      UNIQUE (workspace_id, client_id, exercise_key)
    )`,
  ],
}, {
  version: 4,
  checksum: "t03-dev-training-execution-v4-extra-warmups-20261018",
  statements: [
    // Дополнительные разминочные подходы сверх плана (решение владельца 2026-10-18, как в 2.0) и мягкое
    // удаление: факт не стирается, а скрывается из дневника, «Пред.» и статистики.
    `ALTER TABLE dev_training_performed_sets ADD COLUMN extra INTEGER NOT NULL DEFAULT 0 CHECK (extra IN (0, 1))`,
    `ALTER TABLE dev_training_performed_sets ADD COLUMN removed_at TEXT`,
    `CREATE TRIGGER dev_training_performed_sets_extra_warmup_insert BEFORE INSERT ON dev_training_performed_sets
      WHEN NEW.extra = 1 AND NEW.set_type <> 'WARMUP'
      BEGIN SELECT RAISE(ABORT, 'INVALID_METRIC'); END`,
    `CREATE TRIGGER dev_training_performed_sets_extra_warmup_update BEFORE UPDATE OF set_type, extra ON dev_training_performed_sets
      WHEN NEW.extra = 1 AND NEW.set_type <> 'WARMUP'
      BEGIN SELECT RAISE(ABORT, 'INVALID_METRIC'); END`,
  ],
}, {
  version: 5,
  checksum: "t03-dev-training-execution-v5-sides-20261018",
  statements: [
    // §48.66, §48.70: стороны одностороннего подхода. Засчитанный по сторонам подход хранит значения в строках
    // сторон, поэтому CHECK подхода допускает пустые значения при sided = 1. CHECK в SQLite не меняется
    // на месте — подходы и мини-сеты пересобираются с теми же данными, связи и триггеры восстанавливаются.
    `CREATE TABLE dev_training_performed_sets_v5 (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      planned_set_id TEXT NOT NULL,
      planned_exercise_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL CHECK (exercise_id LIKE 'sys:%' OR exercise_id LIKE 'usr:%'),
      position INTEGER NOT NULL CHECK (position >= 0),
      set_type TEXT NOT NULL CHECK (set_type IN ('NORMAL','WARMUP','FAILURE','DROP')),
      reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 1 AND 999),
      load_grams INTEGER CHECK (load_grams IS NULL OR load_grams BETWEEN 0 AND 1000000),
      duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
      distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
      rpe INTEGER CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
      confirmed_at TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('INPUT','COPY','IMPORT')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL,
      extra INTEGER NOT NULL DEFAULT 0 CHECK (extra IN (0, 1)),
      removed_at TEXT,
      sided INTEGER NOT NULL DEFAULT 0 CHECK (sided IN (0, 1)),
      CHECK (CASE WHEN confirmed_at IS NULL OR sided = 1 THEN 1
        ELSE COALESCE(reps, load_grams, duration_sec, distance_m) IS NOT NULL END),
      UNIQUE (workspace_id, session_id, planned_set_id),
      FOREIGN KEY (session_id, workspace_id) REFERENCES dev_training_sessions(id, workspace_id) ON DELETE RESTRICT
    )`,
    `INSERT INTO dev_training_performed_sets_v5 (id, workspace_id, session_id, planned_set_id, planned_exercise_id, exercise_id, position, set_type, reps,
      load_grams, duration_sec, distance_m, rpe, confirmed_at, origin, revision, updated_at, extra, removed_at) SELECT id, workspace_id, session_id, planned_set_id, planned_exercise_id, exercise_id, position, set_type, reps,
      load_grams, duration_sec, distance_m, rpe, confirmed_at, origin, revision, updated_at, extra, removed_at FROM dev_training_performed_sets`,
    `CREATE TABLE dev_training_performed_drops_v5 (
      workspace_id TEXT NOT NULL,
      set_id TEXT NOT NULL REFERENCES dev_training_performed_sets_v5(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position BETWEEN 2 AND 10),
      reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 1 AND 999),
      load_grams INTEGER CHECK (load_grams IS NULL OR load_grams BETWEEN 0 AND 1000000),
      duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
      distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
      PRIMARY KEY (workspace_id, set_id, position)
    )`,
    `INSERT INTO dev_training_performed_drops_v5 (workspace_id, set_id, position, reps, load_grams, duration_sec, distance_m)
      SELECT workspace_id, set_id, position, reps, load_grams, duration_sec, distance_m FROM dev_training_performed_drops`,
    `DROP TABLE dev_training_performed_drops`,
    `DROP TABLE dev_training_performed_sets`,
    `ALTER TABLE dev_training_performed_sets_v5 RENAME TO dev_training_performed_sets`,
    `ALTER TABLE dev_training_performed_drops_v5 RENAME TO dev_training_performed_drops`,
    `CREATE INDEX dev_training_performed_sets_exercise ON dev_training_performed_sets(workspace_id, exercise_id)`,
    `CREATE TRIGGER dev_training_performed_sets_identity_fixed BEFORE UPDATE OF session_id, planned_set_id,
        exercise_id ON dev_training_performed_sets
      WHEN NEW.session_id IS NOT OLD.session_id OR NEW.planned_set_id IS NOT OLD.planned_set_id
        OR NEW.exercise_id IS NOT OLD.exercise_id
      BEGIN SELECT RAISE(ABORT, 'FACT_IDENTITY_FIXED'); END`,
    `CREATE TRIGGER dev_training_performed_sets_extra_warmup_insert BEFORE INSERT ON dev_training_performed_sets
      WHEN NEW.extra = 1 AND NEW.set_type <> 'WARMUP'
      BEGIN SELECT RAISE(ABORT, 'INVALID_METRIC'); END`,
    `CREATE TRIGGER dev_training_performed_sets_extra_warmup_update BEFORE UPDATE OF set_type, extra ON dev_training_performed_sets
      WHEN NEW.extra = 1 AND NEW.set_type <> 'WARMUP'
      BEGIN SELECT RAISE(ABORT, 'INVALID_METRIC'); END`,
    `CREATE TRIGGER dev_training_performed_drops_only_drop BEFORE INSERT ON dev_training_performed_drops
      WHEN COALESCE((SELECT set_type FROM dev_training_performed_sets WHERE id = NEW.set_id), '') <> 'DROP'
      BEGIN SELECT RAISE(ABORT, 'INVALID_METRIC'); END`,
    `CREATE TABLE dev_training_performed_sides (
      workspace_id TEXT NOT NULL,
      set_id TEXT NOT NULL REFERENCES dev_training_performed_sets(id) ON DELETE RESTRICT,
      side TEXT NOT NULL CHECK (side IN ('L','R')),
      reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 1 AND 999),
      load_grams INTEGER CHECK (load_grams IS NULL OR load_grams BETWEEN 0 AND 1000000),
      duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
      distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
      confirmed_at TEXT,
      CHECK (CASE WHEN confirmed_at IS NULL THEN 1
        ELSE COALESCE(reps, load_grams, duration_sec, distance_m) IS NOT NULL END),
      PRIMARY KEY (workspace_id, set_id, side)
    )`,
  ],
}, {
  version: 6,
  checksum: "t03-dev-training-execution-v6-exercise-notes-20261018",
  statements: [
    // §48.67: заметка о фактическом выполнении упражнения в конкретной тренировке (не плановое указание).
    `CREATE TABLE dev_training_exercise_notes (
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      planned_exercise_id TEXT NOT NULL,
      note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 1000),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, session_id, planned_exercise_id),
      FOREIGN KEY (session_id, workspace_id) REFERENCES dev_training_sessions(id, workspace_id) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 7,
  checksum: "t04-dev-training-execution-v7-week-number-is-position-20261018",
  statements: [
    // §48.21 п. 6: номер недели — её позиция. Перестановка недель меняет его у выполнений вместе с тренировкой;
    // клиент, программа и плановая тренировка выполнения по-прежнему неизменны.
    `DROP TRIGGER dev_training_sessions_slot_fixed`,
    `CREATE TRIGGER dev_training_sessions_slot_fixed BEFORE UPDATE OF client_id, program_id, planned_workout_id
        ON dev_training_sessions
      WHEN NEW.client_id IS NOT OLD.client_id OR NEW.program_id IS NOT OLD.program_id
        OR NEW.planned_workout_id IS NOT OLD.planned_workout_id
      BEGIN SELECT RAISE(ABORT, 'WRONG_CLIENT_SCOPE'); END`,
  ],
}, {
  version: 8,
  checksum: "t07-dev-training-execution-v8-plan-deleted-origin-20261019",
  statements: [
    // §50.3 действие 1: «Удалить план, сохранить историю». Выполнение хранит неизменяемый снимок происхождения
    // (программа, тип, мезоцикл, тренировка) и дату удаления плана — история не становится безымянной.
    `ALTER TABLE dev_training_sessions ADD COLUMN origin_json TEXT
      CHECK (CASE WHEN origin_json IS NULL THEN 1 ELSE json_valid(origin_json) END)`,
    `ALTER TABLE dev_training_sessions ADD COLUMN plan_deleted_at TEXT
      CHECK (CASE WHEN plan_deleted_at IS NULL THEN origin_json IS NULL ELSE origin_json IS NOT NULL AND length(plan_deleted_at) > 0 END)`,
    `CREATE TRIGGER dev_training_sessions_origin_fixed BEFORE UPDATE OF origin_json, plan_deleted_at ON dev_training_sessions
      WHEN OLD.plan_deleted_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'ORIGIN_IMMUTABLE'); END`,
  ],
}];
