import type { LegacyExecutionSource, ExecutionRaw as Raw } from "./LegacyExecutionSourceReader.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";
import { parseLegacyExecutionMetricJson } from "./LegacyExecutionMetricJson.ts";

function fail(code: string): never { throw new Error(`R04_ID_LEDGER_EXECUTION_SNAPSHOT_${code}`); }
const text = (v: unknown): string => typeof v === "string" && v.trim() ? v : fail("IDENTITY_INVALID");
function object(v: unknown): Raw { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Raw : fail("OBJECT_INVALID"); }
const pointer = (v: string) => v.replaceAll("~", "~0").replaceAll("/", "~1");
export interface LegacySnapshotSet {
  readonly path: string; readonly exerciseId: string; readonly derivedCacheId: string;
  readonly catalogRefs: readonly unknown[]; readonly name: string | null; readonly position: number;
  readonly raw: Raw; readonly segments: readonly Raw[] | null;
}
export interface LegacyWorkoutSnapshot {
  readonly id: string; readonly client: string; readonly workoutId: string; readonly deleted: boolean;
  readonly raw: Raw; readonly sets: readonly LegacySnapshotSet[];
}
/** Shapes and cache ID construction observed in v2 migration 021. Neither the
 * ID we can construct nor numeric values alone prove a completed set. */
export function readLegacyWorkoutSnapshots(source: LegacyExecutionSource): readonly LegacyWorkoutSnapshot[] {
  const seen = new Set<string>();
  return (source.tables.training_workout_logs ?? []).map((row) => {
    const id = text(row.id), client = text(row.client_id), workoutId = text(row.workout_id);
    if (seen.has(id)) return fail("DUPLICATE_ID"); seen.add(id);
    const deleted = row.deleted_at === null ? false : isExplicitTimestamp(row.deleted_at) ? true : fail("LIFECYCLE_INVALID");
    if (deleted) return { id, client, workoutId, deleted, raw: row, sets: [] };
    const parsed = parseLegacyExecutionMetricJson(row.data_json);
    const exercises = object(parsed).exercises;
    if (exercises === null || typeof exercises !== "object") return fail("EXERCISES_INVALID");
    const sets: LegacySnapshotSet[] = [];
    for (const [exerciseKey, raw] of Object.entries(exercises)) {
      const exercise = Array.isArray(raw) ? {} : object(raw);
      const exerciseId = exercise.exerciseId == null || exercise.exerciseId === "" ? exercise.id == null || exercise.id === "" ? exerciseKey : text(exercise.id) : text(exercise.exerciseId);
      const values: unknown = Array.isArray(raw) ? raw : exercise.sets;
      if (!Array.isArray(values)) return fail("SETS_INVALID");
      const path = `/exercises/${pointer(exerciseKey)}${Array.isArray(raw) ? "" : "/sets"}`;
      for (const [position, value] of values.entries()) {
        const set = object(value);
        if (set.segments != null && !Array.isArray(set.segments)) return fail("SEGMENTS_INVALID");
        sets.push({ path: `${path}/${position}`, exerciseId, derivedCacheId: `${id}:${exerciseId}:${position}`,
          catalogRefs: [exercise.templateExerciseId, exercise.catalogId],
          name: typeof exercise.name === "string" && exercise.name !== "" ? exercise.name : typeof exercise.exerciseName === "string" ? exercise.exerciseName : null,
          position, raw: set, segments: set.segments == null ? null : (set.segments as unknown[]).map(object) });
      }
    }
    return { id, client, workoutId, deleted, raw: row, sets };
  });
}
