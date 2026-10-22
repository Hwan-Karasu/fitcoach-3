import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";
import { guardRows, immutableScope, jsonText, preflight, validJson } from "../../../../shared/db/SchemaGuards.ts";
const origin = (row: string): string => `${row}.origin_json IS NULL OR ${validJson(`${row}.origin_json`,
  `${jsonText(`${row}.origin_json`, "$.programTitle")} AND json_extract(${row}.origin_json, '$.programKind') IN ('SIMPLE','PERIODIZED')
    AND json_type(${row}.origin_json, '$.mesocycleTitle') IN ('text','null') AND json_type(${row}.origin_json, '$.workoutTitle') IN ('text','null')`)}`;
const checks = [
  { table: "training_sessions", valid: origin },
  ...["training_performed_drops", "training_performed_sides"].map((table) => ({ table, valid: (row: string) =>
    `EXISTS (SELECT 1 FROM training_performed_sets AS parent WHERE parent.id = ${row}.set_id AND parent.workspace_id = ${row}.workspace_id)` })),
];
export const executionIntegrityMigration: MigrationStep = {
  version: 2, checksum: "d01-execution-v2-owner-json-20261022",
  statements: [...preflight("execution", checks),
    ...checks.flatMap((check) => guardRows(`${check.table}_integrity`, check.table, check.valid, "TRAINING_INTEGRITY_INVALID")),
    immutableScope("training_sessions", ["id", "workspace_id"]),
    immutableScope("training_performed_sets", ["id", "workspace_id"]),
  ],
};
