import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";

/** Execution owns this lookup. Called under the same writer transaction as an
 * Exercise metadata command; no concurrent input can pass between check/save. */
export async function hasTrainingExerciseFacts(tx: SqliteStatementPort, workspaceId: string, exerciseId: string): Promise<boolean> {
  return await tx.first("SELECT 1 FROM training_performed_sets WHERE workspace_id=? AND exercise_id=? LIMIT 1", [workspaceId, exerciseId]) !== null;
}
