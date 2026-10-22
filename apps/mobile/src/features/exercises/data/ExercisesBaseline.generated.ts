import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

/**
 * D01: базовая миграция владельца `exercises` — итоговая схема dev-цепочки без префикса `dev_`.
 * Файл создаётся `npm run d01:baseline` (scripts/d01/generate-baseline.ts); вручную не правится. Дальнейшие изменения схемы — только
 * новые миграции версий 2, 3, … в журнале `exercises_schema_migrations`.
 */
export const exercisesBaseline: readonly MigrationStep[] = [{
  version: 1,
  checksum: "d01-baseline-exercises-bbb50ba5dbd9686d",
  statements: [
    "CREATE TABLE custom_exercises (\n      id TEXT PRIMARY KEY NOT NULL,\n      workspace_id TEXT NOT NULL,\n      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),\n      body_part TEXT NOT NULL CHECK (body_part IN ('chest','back','shoulders','upper_arms','lower_arms','core','upper_legs','lower_legs','full_body')),\n      equipment TEXT,\n      tracking_profile TEXT NOT NULL CHECK (tracking_profile IN ('REPS','LOAD_REPS','ADDED_LOAD_REPS','ASSISTANCE_REPS','DURATION','REPS_DURATION','DISTANCE_DURATION','LOAD_DISTANCE','LOAD_DURATION')),\n      revision INTEGER NOT NULL CHECK (revision > 0),\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL,\n      archived_at TEXT,\n      CHECK (id LIKE 'usr:%')\n    )",
    "CREATE TABLE exercise_overlay (\n      workspace_id TEXT NOT NULL,\n      exercise_id TEXT NOT NULL,\n      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),\n      hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),\n      display_name TEXT CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 80),\n      aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),\n      updated_at TEXT NOT NULL,\n      PRIMARY KEY (workspace_id, exercise_id)\n    )",
  ],
}];
