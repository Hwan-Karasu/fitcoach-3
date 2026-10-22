/** Archived pre-baseline dev chain, for generation and historical fixture tests only. */
import type { MigrationStep } from "../../../apps/mobile/src/shared/db/MigrationRunner.ts";
import { BODY_PARTS, TRACKING_PROFILE_IDS } from "../../../apps/mobile/src/features/exercises/domain/ExerciseModel.ts";
import { EXERCISE_NAME_MAX } from "../../../apps/mobile/src/features/exercises/domain/ExerciseRules.ts";

export const DEV_EXERCISES_LEDGER = "exercises_schema_migrations";

const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(",");

/** Dev-схема своих упражнений и личного слоя. Системные упражнения — из снимка RepDB, не из таблиц. */
export const devExerciseCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "x01-dev-exercises-v1-custom-overlay-20261017",
  statements: [
    `CREATE TABLE custom_exercises (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND ${EXERCISE_NAME_MAX}),
      body_part TEXT NOT NULL CHECK (body_part IN (${list(BODY_PARTS)})),
      equipment TEXT,
      tracking_profile TEXT NOT NULL CHECK (tracking_profile IN (${list(TRACKING_PROFILE_IDS)})),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      CHECK (id LIKE 'usr:%')
    )`,
    `CREATE TABLE exercise_overlay (
      workspace_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
      display_name TEXT CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND ${EXERCISE_NAME_MAX}),
      aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, exercise_id)
    )`,
  ],
}];

