import type { DatabaseSync } from "node:sqlite";
import { requireLegacyColumns } from "./LegacyExerciseCatalogSourceReader.ts";

export const PLAN_SOURCE_TABLES = ["training_programs", "training_weeks", "training_workouts", "training_exercises", "training_set_logs",
  "training_library_programs", "training_workspaces", "training_program_view_state", "training_library_preferences", "training_archive_entries"] as const;
export type PlanSourceTable = typeof PLAN_SOURCE_TABLES[number];
export interface LegacyPlansSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<PlanSourceTable, readonly Readonly<Record<string, unknown>>[] | null>>;
}
const required: Readonly<Record<PlanSourceTable, readonly string[]>> = {
  training_programs: ["id", "client_id", "mode", "name", "cycle_type", "settings_json", "book_id", "is_template", "created_at", "updated_at", "deleted_at"],
  training_weeks: ["id", "program_id", "week_index", "week_type", "data_json", "deleted_at"],
  training_workouts: ["id", "client_id", "program_id", "week_id", "sort_index", "name", "data_json", "created_at", "updated_at", "deleted_at"],
  training_exercises: ["id", "workout_id", "sort_index", "name", "note", "template_exercise_id", "data_json", "deleted_at"],
  training_set_logs: ["id", "exercise_id", "set_index", "reps", "weight", "rpe", "completed_at", "data_json", "deleted_at"],
  training_library_programs: ["id", "client_id", "name", "mode", "created_at", "archived_at"],
  training_workspaces: ["client_id", "active_program_id", "week_state_json", "updated_at", "deleted_at"],
  training_program_view_state: ["actor_id", "client_id", "library_id", "selected_program_id", "state_json"],
  training_library_preferences: ["actor_id", "client_id", "preferred_id"],
  training_archive_entries: ["id", "client_id", "data_json", "archived_at"],
};
/** Caller owns the immutable read snapshot. Optional table absence remains null;
 * no prior source normalizers, JSON repairs, auth/permissions or trigger replay. */
export function readLegacyPlansInSnapshot(db: DatabaseSync, accountScope: string): LegacyPlansSource {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const tables = Object.fromEntries(PLAN_SOURCE_TABLES.map((table, index) => {
    const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table);
    if (!exists && index >= 5) return [table, null];
    requireLegacyColumns(db, table, required[table], "R04_PLANS_SHAPE_UNSUPPORTED");
    const rows = db.prepare(`SELECT * FROM ${table}`).all().map((row) => ({ ...row }));
    if (rows.length !== db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) throw new Error("R04_PLANS_CARDINALITY_MISMATCH");
    return [table, rows];
  })) as Record<PlanSourceTable, readonly Readonly<Record<string, unknown>>[] | null>;
  return { accountScope, tables };
}
