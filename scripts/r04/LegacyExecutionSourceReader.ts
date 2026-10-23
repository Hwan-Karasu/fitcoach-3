import type { DatabaseSync } from "node:sqlite";
import { requireLegacyColumns } from "./LegacyExerciseCatalogSourceReader.ts";

export const EXECUTION_SOURCE_TABLES = ["training_sessions", "training_session_exercises", "training_session_sets",
  "training_set_segments", "training_exercise_history"] as const;
export type ExecutionSourceTable = typeof EXECUTION_SOURCE_TABLES[number];
export type ExecutionRaw = Readonly<Record<string, unknown>>;
export interface LegacyExecutionSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<ExecutionSourceTable, readonly ExecutionRaw[] | null>>;
}
const columns: Readonly<Record<ExecutionSourceTable, readonly string[]>> = {
  training_sessions: ["id", "client_id", "source_workout_id", "program_key", "week_key", "workout_name", "performed_at", "date_source", "data_json", "deleted_at"],
  training_session_exercises: ["id", "session_id", "source_exercise_id", "catalog_id", "exercise_key", "name", "sort_index", "data_json", "deleted_at"],
  training_session_sets: ["id", "session_exercise_id", "source_fact_id", "set_index", "reps", "weight", "rpe", "set_kind", "effort_outcome", "completed_at", "segments_json", "data_json", "deleted_at"],
  training_set_segments: ["id", "set_log_id", "segment_index", "reps", "weight", "deleted_at"],
  training_exercise_history: ["id", "client_id", "exercise_key", "source_fact_id", "data_json", "updated_at", "deleted_at"],
};
/** Caller holds the same immutable source snapshot as Plans/catalog. Missing
 * optional stores stay null, never reconstructed by running v2 migrations. */
export function readLegacyExecutionInSnapshot(db: DatabaseSync, accountScope: string): LegacyExecutionSource {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const tables = Object.fromEntries(EXECUTION_SOURCE_TABLES.map((table) => {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) {
      if (table === "training_exercise_history") throw new Error("R04_EXECUTION_SOURCE_SHAPE_UNSUPPORTED");
      return [table, null];
    }
    requireLegacyColumns(db, table, columns[table], "R04_EXECUTION_SOURCE_SHAPE_UNSUPPORTED");
    const rows = db.prepare(`SELECT * FROM ${table}`).all().map((r) => ({ ...r }));
    if (rows.length !== db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) throw new Error("R04_EXECUTION_SOURCE_COVERAGE_MISMATCH");
    return [table, rows];
  })) as Record<ExecutionSourceTable, readonly ExecutionRaw[] | null>;
  const observed = EXECUTION_SOURCE_TABLES.slice(0, 3).filter((t) => tables[t] !== null).length;
  if (observed !== 0 && observed !== 3) throw new Error("R04_EXECUTION_SOURCE_PARTIAL_SESSION_STORE");
  return { accountScope, tables };
}
