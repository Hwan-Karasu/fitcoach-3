import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";
import { trainingExecutionBaseline } from "./TrainingExecutionBaseline.generated.ts";
import { executionIntegrityMigration } from "./ExecutionIntegrityMigration.ts";

// Rebuild the owner dependency tree child-first, with transactional snapshots. Foreign keys stay enabled.
// Only actual_date nullability changes; identities, values, indexes and all owner guards are preserved.
const tables = ["training_sessions", "training_performed_sets", "training_performed_drops", "training_performed_sides", "training_exercise_notes"] as const;
const baseline = trainingExecutionBaseline[0]!.statements;
const createTable = (table: string) => {
  const statement = baseline.find((sql) => new RegExp(`^CREATE TABLE "?${table}"? \\(`, "u").test(sql));
  if (!statement) throw new Error("EXECUTION_DATE_MIGRATION_BASELINE_MISSING");
  return table === "training_sessions" ? statement.replace("actual_date TEXT NOT NULL CHECK", "actual_date TEXT CHECK") : statement;
};
export const unknownWorkoutDateMigration: MigrationStep = {
  version: 3, checksum: "execution-v3-nullable-import-date-20261026",
  statements: [
    ...tables.map((table) => `CREATE TEMP TABLE i06_${table} AS SELECT * FROM ${table}`),
    ...[...tables].reverse().map((table) => `DROP TABLE ${table}`),
    ...tables.map(createTable),
    ...tables.map((table) => `INSERT INTO ${table} SELECT * FROM i06_${table}`),
    ...tables.map((table) => `DROP TABLE i06_${table}`),
    ...baseline.filter((sql) => /^CREATE (INDEX|TRIGGER) /u.test(sql) && tables.some((table) => new RegExp(`\\bON ${table}\\b`, "iu").test(sql))),
    ...executionIntegrityMigration.statements,
  ],
};
