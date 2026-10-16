import type { DatabaseSync } from "node:sqlite";

export interface LegacyWorkoutSnapshotSource {
  readonly accountScope: string;
  readonly sourceRowId: string;
  readonly clientId: string;
  readonly sourceWorkoutId: string;
  readonly ownerLinkStatus: "matched" | "missing-workout" | "different-client";
  readonly dataStatus: "exercise-array" | "invalid-json" | "missing-exercise-array";
  readonly lifecycleShapeComplete: boolean;
  readonly deletedAtRaw: string | null;
}

type RawSnapshotRow = Readonly<{
  sourceRowId: unknown;
  clientId: unknown;
  ownerClientId: unknown;
  sourceWorkoutId: unknown;
  workoutClientId: unknown;
  dataJson: unknown;
  deletedAtRaw: unknown;
}>;

function textOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("R04_WORKOUT_SNAPSHOT_VALUE_UNSUPPORTED");
  return value;
}

function dataStatus(value: unknown): LegacyWorkoutSnapshotSource["dataStatus"] {
  if (typeof value !== "string") return "invalid-json";
  let data: unknown;
  try { data = JSON.parse(value) as unknown; }
  catch { return "invalid-json"; }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "invalid-json";
  return Array.isArray((data as Record<string, unknown>).exercises)
    ? "exercise-array" : "missing-exercise-array";
}

/** Physical workout snapshots, not proof that a specific nested set was performed. */
export function readLegacyWorkoutSnapshotRowsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyWorkoutSnapshotSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const required: Readonly<Record<string, readonly string[]>> = {
    training_workout_logs: ["id", "client_id", "workout_id", "data_json"],
    training_workouts: ["id", "client_id"],
    clients: ["id"],
  };
  let lifecycleShapeComplete = false;
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    if (columns.some((column) => !actual.has(column))) throw new Error("R04_WORKOUT_SNAPSHOT_SHAPE_UNSUPPORTED");
    if (table === "training_workout_logs") lifecycleShapeComplete = actual.has("deleted_at");
  }
  const deletionColumn = lifecycleShapeComplete ? "wl.deleted_at" : "NULL";
  const rows = db.prepare(`SELECT wl.id AS sourceRowId, wl.client_id AS clientId,
      c.id AS ownerClientId, wl.workout_id AS sourceWorkoutId,
      w.client_id AS workoutClientId, wl.data_json AS dataJson,
      ${deletionColumn} AS deletedAtRaw
    FROM training_workout_logs wl
    LEFT JOIN clients c ON c.id=wl.client_id
    LEFT JOIN training_workouts w ON w.id=wl.workout_id
    ORDER BY wl.id`).all() as unknown as RawSnapshotRow[];
  const physicalCount = db.prepare("SELECT count(*) AS count FROM training_workout_logs").get() as { count: number };
  if (rows.length !== physicalCount.count) throw new Error("R04_WORKOUT_SNAPSHOT_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyWorkoutSnapshotSource => {
    const sourceRowId = textOrNull(row.sourceRowId);
    const clientId = textOrNull(row.clientId);
    const ownerClientId = textOrNull(row.ownerClientId);
    const sourceWorkoutId = textOrNull(row.sourceWorkoutId);
    const workoutClientId = textOrNull(row.workoutClientId);
    if (!sourceRowId?.trim() || !clientId?.trim() || ownerClientId !== clientId
      || !sourceWorkoutId?.trim()) {
      throw new Error("R04_WORKOUT_SNAPSHOT_PROVENANCE_INCOMPLETE");
    }
    const ownerLinkStatus = workoutClientId === null ? "missing-workout"
      : workoutClientId === clientId ? "matched" : "different-client";
    return { accountScope, sourceRowId, clientId, sourceWorkoutId, ownerLinkStatus,
      dataStatus: dataStatus(row.dataJson), lifecycleShapeComplete,
      deletedAtRaw: textOrNull(row.deletedAtRaw) };
  });
}
