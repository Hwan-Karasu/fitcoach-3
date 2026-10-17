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
}];
