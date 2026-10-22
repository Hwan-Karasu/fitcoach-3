import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";
import { guardRows, immutableScope, preflight, validJson } from "../../../../shared/db/SchemaGuards.ts";
import { builderSql, mesocycleSql, periodizedDraftSql, simpleHistorySql, templateSql, workoutSql } from "./PlansJsonSql.ts";

const jsonChecks = [
  ["training_simple_overrides", "workout_json", workoutSql], ["training_simple_versions", "structure_json", simpleHistorySql],
  ["training_structure_versions", "structure_json", mesocycleSql], ["training_templates", "payload_json", templateSql],
  ["training_builder_drafts", "draft_json", builderSql], ["training_periodized_drafts", "draft_json", periodizedDraftSql],
] as const;
const checks = jsonChecks.map(([table, column, shape]) => ({ table, name: `${table}_json_shape`,
  valid: (row: string) => validJson(`${row}.${column}`, `${shape(`${row}.${column}`)}${table === "training_templates"
    ? ` AND json_extract(${row}.${column}, '$.kind') = ${row}.kind` : table === "training_structure_versions"
      ? ` AND json_extract(${row}.${column}, '$.id') = ${row}.mesocycle_id` : ""}`) }));
export const plansIntegrityMigration: MigrationStep = {
  version: 2, checksum: "d01-plans-v2-owner-json-20261022",
  statements: [...preflight("plans", checks),
    ...checks.flatMap((check) => guardRows(check.name, check.table, check.valid, "TRAINING_JSON_INVALID")),
    immutableScope("training_programs", ["id", "workspace_id"]),
  ],
};
