import type { SqlValue, SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import { insertRows } from "../../../../shared/db/BatchInsert.ts";
import type { TransferSession, TransferValues } from "../../../../shared/training-transfer/TrainingTransfer.ts";

/**
 * Preserves historical values and confirmation independently of the current trainer mode.
 * Rows are written in batches (sessions, then sets, then their drops and sides, then notes): on a phone every statement is a
 * round trip through the Expo bridge, so row-by-row import of thousands of sets took tens of seconds.
 */
export async function importTrainingExecutions(tx: SqliteStatementPort, workspace: string, client: string, sessions: readonly TransferSession[]): Promise<void> {
  const stamp = new Date().toISOString();
  const values = (v: TransferValues) => [v.reps, v.loadGrams, v.durationSec, v.distanceM];
  const sessionRows: SqlValue[][] = []; const setRows: SqlValue[][] = []; const dropRows: SqlValue[][] = []; const sideRows: SqlValue[][] = []; const noteRows: SqlValue[][] = [];
  for (const s of sessions) {
    // An imported historical workout may be closed without a known day. Never invent its date.
    sessionRows.push([s.id, workspace, client, s.programId, s.weekIndex, s.plannedWorkoutId, s.outcome, s.actualDate, s.startedAt, s.finishedAt, 1, stamp, stamp, s.origin ? JSON.stringify(s.origin) : null, s.origin ? stamp : null]);
    for (const f of s.facts) {
      setRows.push([f.id, workspace, s.id, f.plannedSetId, f.plannedExerciseId, f.exerciseId, f.position, f.setType, ...values(f.values), f.rpe, f.confirmed ? stamp : null, f.origin, f.revision, stamp, Number(f.extra), Number(f.sides !== null)]);
      for (const [index, drop] of f.drops.entries()) dropRows.push([workspace, f.id, index + 2, ...values(drop)]);
      if (f.sides) for (const [side, fact] of [["L", f.sides.left], ["R", f.sides.right]] as const) sideRows.push([workspace, f.id, side, ...values(fact.values), fact.confirmed ? stamp : null]);
    }
    for (const note of s.notes) noteRows.push([workspace, s.id, note.plannedExerciseId, note.text, stamp]);
  }
  await insertRows(tx, "training_sessions", ["id", "workspace_id", "client_id", "program_id", "week_index", "planned_workout_id", "outcome", "actual_date",
    "started_at", "finished_at", "revision", "created_at", "updated_at", "origin_json", "plan_deleted_at"], sessionRows);
  await insertRows(tx, "training_performed_sets", ["id", "workspace_id", "session_id", "planned_set_id", "planned_exercise_id", "exercise_id", "position", "set_type",
    "reps", "load_grams", "duration_sec", "distance_m", "rpe", "confirmed_at", "origin", "revision", "updated_at", "extra", "sided"], setRows);
  await insertRows(tx, "training_performed_drops", ["workspace_id", "set_id", "position", "reps", "load_grams", "duration_sec", "distance_m"], dropRows);
  await insertRows(tx, "training_performed_sides", ["workspace_id", "set_id", "side", "reps", "load_grams", "duration_sec", "distance_m", "confirmed_at"], sideRows);
  await insertRows(tx, "training_exercise_notes", ["workspace_id", "session_id", "planned_exercise_id", "note", "updated_at"], noteRows);
}
