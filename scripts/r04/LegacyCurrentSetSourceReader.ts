import type { DatabaseSync } from "node:sqlite";

export interface LegacyCurrentSetSource {
  readonly accountScope: string;
  readonly sourceRowId: string;
  readonly clientId: string;
  readonly sourceWorkoutId: string;
  readonly effectiveSourceFactId: string | null;
  readonly originStatus: "row-id" | "history-origin-id" | "invalid-json" | "unsupported-origin";
  readonly lifecycleShapeComplete: boolean;
  readonly setDeletedAtRaw: string | null;
  readonly exerciseDeletedAtRaw: string | null;
  readonly workoutDeletedAtRaw: string | null;
  readonly completedAtRaw: string | null;
}

type RawCurrentSetRow = Readonly<{
  sourceRowId: unknown;
  exerciseId: unknown;
  joinedExerciseId: unknown;
  sourceWorkoutId: unknown;
  clientId: unknown;
  dataJson: unknown;
  setDeletedAtRaw: unknown;
  exerciseDeletedAtRaw: unknown;
  workoutDeletedAtRaw: unknown;
  completedAtRaw: unknown;
}>;

function sourceText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("R04_CURRENT_SOURCE_VALUE_UNSUPPORTED");
  return value;
}

function originFromJson(sourceRowId: string, dataJson: unknown): Pick<LegacyCurrentSetSource,
  "effectiveSourceFactId" | "originStatus"> {
  if (typeof dataJson !== "string") return { effectiveSourceFactId: null, originStatus: "invalid-json" };
  let data: unknown;
  try { data = JSON.parse(dataJson) as unknown; }
  catch { return { effectiveSourceFactId: null, originStatus: "invalid-json" }; }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { effectiveSourceFactId: null, originStatus: "invalid-json" };
  }
  const origin = (data as Record<string, unknown>).historyOriginId;
  if (origin === undefined || origin === null || origin === "") {
    return { effectiveSourceFactId: sourceRowId, originStatus: "row-id" };
  }
  if (typeof origin !== "string" || !origin.trim()) {
    return { effectiveSourceFactId: null, originStatus: "unsupported-origin" };
  }
  return { effectiveSourceFactId: origin, originStatus: "history-origin-id" };
}

/** Reads physical current-set rows without treating them as performed facts. Caller owns the snapshot. */
export function readLegacyCurrentSetRowsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyCurrentSetSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const required: Readonly<Record<string, readonly string[]>> = {
    training_set_logs: ["id", "exercise_id", "data_json"],
    training_exercises: ["id", "workout_id"],
    training_workouts: ["id", "client_id"],
  };
  const shapes = new Map<string, Set<string>>();
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    if (columns.some((column) => !actual.has(column))) throw new Error("R04_CURRENT_SOURCE_SHAPE_UNSUPPORTED");
    shapes.set(table, actual);
  }
  const setColumns = shapes.get("training_set_logs")!;
  const exerciseColumns = shapes.get("training_exercises")!;
  const workoutColumns = shapes.get("training_workouts")!;
  const lifecycleShapeComplete = setColumns.has("deleted_at") && setColumns.has("completed_at")
    && exerciseColumns.has("deleted_at") && workoutColumns.has("deleted_at");
  const optional = (alias: string, column: string, columns: Set<string>) =>
    columns.has(column) ? `${alias}.${column}` : "NULL";
  const rows = db.prepare(`SELECT f.id AS sourceRowId, f.exercise_id AS exerciseId,
      e.id AS joinedExerciseId, w.id AS sourceWorkoutId,
      w.client_id AS clientId, f.data_json AS dataJson,
      ${optional("f", "deleted_at", setColumns)} AS setDeletedAtRaw,
      ${optional("e", "deleted_at", exerciseColumns)} AS exerciseDeletedAtRaw,
      ${optional("w", "deleted_at", workoutColumns)} AS workoutDeletedAtRaw,
      ${optional("f", "completed_at", setColumns)} AS completedAtRaw
    FROM training_set_logs f
    LEFT JOIN training_exercises e ON e.id=f.exercise_id
    LEFT JOIN training_workouts w ON w.id=e.workout_id
    ORDER BY f.id`).all() as unknown as RawCurrentSetRow[];
  const count = db.prepare("SELECT count(*) AS count FROM training_set_logs").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_CURRENT_SOURCE_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyCurrentSetSource => {
    const sourceRowId = sourceText(row.sourceRowId);
    const exerciseId = sourceText(row.exerciseId);
    const joinedExerciseId = sourceText(row.joinedExerciseId);
    const sourceWorkoutId = sourceText(row.sourceWorkoutId);
    const clientId = sourceText(row.clientId);
    if (!sourceRowId?.trim() || !exerciseId?.trim() || exerciseId !== joinedExerciseId
      || !sourceWorkoutId?.trim() || !clientId?.trim()) {
      throw new Error("R04_CURRENT_SOURCE_PROVENANCE_INCOMPLETE");
    }
    return {
      accountScope, sourceRowId, clientId, sourceWorkoutId,
      ...originFromJson(sourceRowId, row.dataJson),
      lifecycleShapeComplete,
      setDeletedAtRaw: sourceText(row.setDeletedAtRaw),
      exerciseDeletedAtRaw: sourceText(row.exerciseDeletedAtRaw),
      workoutDeletedAtRaw: sourceText(row.workoutDeletedAtRaw),
      completedAtRaw: sourceText(row.completedAtRaw),
    };
  });
}
