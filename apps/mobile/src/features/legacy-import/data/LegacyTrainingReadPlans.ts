import { EXECUTION_SOURCE_TABLES, PLAN_SOURCE_TABLES, type ExecutionSourceTable, type LegacyExecutionSource,
  type LegacyPlansSource, type LegacySourceRow, type PlanSourceTable } from "../domain/LegacySourceSnapshots.ts";
import { readLegacySourceTable, type LegacySourceReadPlan } from "./LegacySourceReadPlans.ts";

const plans: Readonly<Record<PlanSourceTable, readonly string[]>> = {
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
const execution: Readonly<Record<ExecutionSourceTable, readonly string[]>> = {
  training_sessions: ["id", "client_id", "source_workout_id", "program_key", "week_key", "workout_name", "performed_at", "date_source", "data_json", "deleted_at"],
  training_session_exercises: ["id", "session_id", "source_exercise_id", "catalog_id", "exercise_key", "name", "sort_index", "data_json", "deleted_at"],
  training_session_sets: ["id", "session_exercise_id", "source_fact_id", "set_index", "reps", "weight", "rpe", "set_kind", "effort_outcome", "completed_at", "segments_json", "data_json", "deleted_at"],
  training_set_segments: ["id", "set_log_id", "segment_index", "reps", "weight", "deleted_at"],
  training_exercise_history: ["id", "client_id", "exercise_key", "source_fact_id", "data_json", "updated_at", "deleted_at"],
  training_workout_logs: ["id", "client_id", "workout_id", "logged_at", "data_json", "deleted_at"],
};
const scope = (value: string) => { if (!value.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED"); };

export function* legacyPlansReadPlan(accountScope: string): LegacySourceReadPlan<LegacyPlansSource> {
  scope(accountScope);
  const tables = {} as Record<PlanSourceTable, readonly LegacySourceRow[] | null>;
  for (const [index, table] of PLAN_SOURCE_TABLES.entries()) {
    const rows = yield* readLegacySourceTable(table, plans[table], "R04_PLANS_SHAPE_UNSUPPORTED", "R04_PLANS_CARDINALITY_MISMATCH");
    if (rows === null && index < 5) throw new Error("R04_PLANS_SHAPE_UNSUPPORTED");
    tables[table] = rows;
  }
  return { accountScope, tables };
}
export function* legacyExecutionReadPlan(accountScope: string): LegacySourceReadPlan<LegacyExecutionSource> {
  scope(accountScope);
  const tables = {} as Record<ExecutionSourceTable, readonly LegacySourceRow[] | null>;
  for (const table of EXECUTION_SOURCE_TABLES) {
    const rows = yield* readLegacySourceTable(table, execution[table], "R04_EXECUTION_SOURCE_SHAPE_UNSUPPORTED", "R04_EXECUTION_SOURCE_COVERAGE_MISMATCH");
    if (rows === null && table === "training_exercise_history") throw new Error("R04_EXECUTION_SOURCE_SHAPE_UNSUPPORTED");
    tables[table] = rows;
  }
  const observed = EXECUTION_SOURCE_TABLES.slice(0, 3).filter((table) => tables[table] !== null).length;
  if (observed !== 0 && observed !== 3) throw new Error("R04_EXECUTION_SOURCE_PARTIAL_SESSION_STORE");
  return { accountScope, tables };
}
