import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";
import { guardRows, jsonArray, jsonText, preflight, validJson } from "../../../../shared/db/SchemaGuards.ts";
import { builderSql, workoutSql } from "./PlansJsonSql.ts";

const cycle = (json: string) => `${jsonText(json, "$.key")} AND ${jsonText(json, "$.title")}
  AND ${jsonArray(json, "$.weeks", "builder_week", (w) => `${jsonText(w, "$.type")} AND ${jsonArray(w, "$.workouts", "builder_workout", workoutSql)}`)}
  AND (json_type(${json}, '$.imported') IS NULL OR (json_type(${json}, '$.imported') = 'object'
    AND ${jsonText(json, "$.imported.sourceId")} AND ${jsonText(json, "$.imported.sourceHash")}
    AND ${jsonArray(json, "$.imported.sessions", "import_session", (s) => `${jsonText(s, "$.id")} AND ${jsonText(s, "$.plannedWorkoutId")} AND json_type(${s}, '$.facts') = 'array' AND json_type(${s}, '$.notes') = 'array'`)}
    AND ${jsonArray(json, "$.imported.matches", "import_match", (m) => `${jsonText(m, "$.sourceName")} AND ${jsonText(m, "$.targetId")}`)}))`;
const valid = (row: string) => validJson(`${row}.draft_json`, `${builderSql(`${row}.draft_json`)} AND
  (json_type(${row}.draft_json, '$.workbook') IS NULL OR (json_type(${row}.draft_json, '$.workbook') = 'object'
    AND json_extract(${row}.draft_json, '$.workbook.version') = 1 AND ${jsonText(`${row}.draft_json`, "$.workbook.activeKey")}
    AND ${jsonArray(`${row}.draft_json`, "$.workbook.cycles", "builder_cycle", cycle)}))`);
export const workbookDraftMigration: MigrationStep = { version: 4, checksum: "plans-v4-workbook-drafts-20261027", statements: [
  ...preflight("workbook_drafts", [{ table: "training_builder_drafts", valid }]),
  "DROP TRIGGER training_builder_drafts_json_shape_insert", "DROP TRIGGER training_builder_drafts_json_shape_update",
  ...guardRows("training_builder_drafts_json_shape", "training_builder_drafts", valid, "TRAINING_JSON_INVALID"),
] };
