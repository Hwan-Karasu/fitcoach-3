import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { TransferSession, TransferValues } from "../../../../shared/training-transfer/TrainingTransfer.ts";

/** Preserves historical values and confirmation independently of the current trainer mode. */
export async function importTrainingExecutions(tx: SqliteStatementPort, workspace: string, client: string, sessions: readonly TransferSession[]): Promise<void> {
  const stamp = new Date().toISOString();
  const values = (v: TransferValues) => [v.reps, v.loadGrams, v.durationSec, v.distanceM];
  for (const s of sessions) {
    // An imported historical workout may be closed without a known day. Never invent its date.
    await tx.run(`INSERT INTO training_sessions(id,workspace_id,client_id,program_id,week_index,planned_workout_id,outcome,actual_date,started_at,finished_at,revision,created_at,updated_at,origin_json,plan_deleted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`, [s.id, workspace, client, s.programId, s.weekIndex, s.plannedWorkoutId, s.outcome, s.actualDate, s.startedAt, s.finishedAt, stamp, stamp, s.origin ? JSON.stringify(s.origin) : null, s.origin ? stamp : null]);
    for (const f of s.facts) {
      await tx.run(`INSERT INTO training_performed_sets(id,workspace_id,session_id,planned_set_id,planned_exercise_id,exercise_id,position,set_type,reps,load_grams,duration_sec,distance_m,rpe,confirmed_at,origin,revision,updated_at,extra,sided)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [f.id, workspace, s.id, f.plannedSetId, f.plannedExerciseId, f.exerciseId, f.position, f.setType, ...values(f.values), f.rpe, f.confirmed ? stamp : null, f.origin, f.revision, stamp, Number(f.extra), Number(f.sides !== null)]);
      for (const [index, drop] of f.drops.entries()) await tx.run(`INSERT INTO training_performed_drops(workspace_id,set_id,position,reps,load_grams,duration_sec,distance_m) VALUES(?,?,?,?,?,?,?)`, [workspace, f.id, index + 2, ...values(drop)]);
      if (f.sides) for (const [side, fact] of [["L", f.sides.left], ["R", f.sides.right]] as const) await tx.run(`INSERT INTO training_performed_sides(workspace_id,set_id,side,reps,load_grams,duration_sec,distance_m,confirmed_at) VALUES(?,?,?,?,?,?,?,?)`, [workspace, f.id, side, ...values(fact.values), fact.confirmed ? stamp : null]);
    }
    for (const note of s.notes) await tx.run(`INSERT INTO training_exercise_notes(workspace_id,session_id,planned_exercise_id,note,updated_at) VALUES(?,?,?,?,?)`, [workspace, s.id, note.plannedExerciseId, note.text, stamp]);
  }
}
