import type { LegacyExerciseReferenceSource } from "../../../../shared/migration/LegacyExerciseSources.ts";
import { readLegacySourceTable as read, type LegacySourceReadPlan } from "../../../../shared/migration/LegacyReadPlan.ts";

/** Same full-row/safe SQL number checks as the admitted multi-owner file reader. */
export function* legacyExerciseReferenceReadPlan(accountScope: string): LegacySourceReadPlan<LegacyExerciseReferenceSource> {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const shape = "R04_EXERCISE_SHAPE_UNSUPPORTED", count = "R04_EXERCISE_REFERENCE_CARDINALITY_MISMATCH";
  const clients = yield* read("clients", ["id"], shape, count, undefined, ["id"]);
  const workouts = yield* read("training_workouts", ["id", "client_id"], shape, count, undefined, ["id"]);
  const exercises = yield* read("training_exercises", ["id", "workout_id", "name", "template_exercise_id", "data_json", "deleted_at"], shape, count, undefined, ["id"]);
  const history = yield* read("training_exercise_history", ["id", "client_id", "exercise_key", "data_json", "deleted_at"], shape, count, undefined, ["id"]);
  if (clients === null || workouts === null || exercises === null || history === null) throw new Error(shape);
  return { accountScope, clients, workouts, exercises, history };
}
