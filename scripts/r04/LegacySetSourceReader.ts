import type { DatabaseSync } from "node:sqlite";
import type { LegacySetSource } from "./SourceFactPreflight.ts";

const requiredShape: Readonly<Record<string, readonly string[]>> = {
  training_session_sets: ["id", "session_exercise_id", "source_fact_id", "reps", "weight"],
  training_session_exercises: ["id", "session_id"],
  training_sessions: ["id", "client_id", "program_key"],
};

interface RawLegacySetRow {
  readonly sourceRowId: unknown;
  readonly clientId: unknown;
  readonly programId: unknown;
  readonly sessionId: unknown;
  readonly sessionExerciseId: unknown;
  readonly sourceFactId: unknown;
  readonly repsRaw: unknown;
  readonly weightRaw: unknown;
  readonly setDeletedAtRaw: unknown;
  readonly sessionDeletedAtRaw: unknown;
  readonly exerciseDeletedAtRaw: unknown;
  readonly completedAtRaw: unknown;
  readonly performedAtRaw: unknown;
}

function textOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("R04_SOURCE_VALUE_UNSUPPORTED");
  return value;
}

/** Read-only selected legacy slice. LEFT JOIN prevents broken links from disappearing silently. */
export function readLegacySetRows(db: DatabaseSync, accountScope: string): readonly LegacySetSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  db.exec("PRAGMA query_only = ON");
  db.exec("BEGIN");
  try { return readLegacySetRowsInSnapshot(db, accountScope); }
  finally { db.exec("ROLLBACK"); }
}

/** Caller must hold a read transaction; used to share one snapshot with history. */
export function readLegacySetRowsInSnapshot(db: DatabaseSync, accountScope: string): readonly LegacySetSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const shapes = new Map<string, Set<string>>();
  for (const [table, columns] of Object.entries(requiredShape)) {
    const actual = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    if (columns.some((column) => !actual.has(column))) throw new Error("R04_SOURCE_SHAPE_UNSUPPORTED");
    shapes.set(table, actual);
  }
  const setColumns = shapes.get("training_session_sets")!;
  const exerciseColumns = shapes.get("training_session_exercises")!;
  const sessionColumns = shapes.get("training_sessions")!;
  const lifecycleShapeComplete = setColumns.has("deleted_at") && setColumns.has("completed_at")
    && exerciseColumns.has("deleted_at") && sessionColumns.has("deleted_at")
    && sessionColumns.has("performed_at");
  const optional = (alias: string, column: string, columns: Set<string>) =>
    columns.has(column) ? `${alias}.${column}` : "NULL";
  const rows = db.prepare(`SELECT f.id AS sourceRowId, s.client_id AS clientId,
      s.program_key AS programId, s.id AS sessionId, e.id AS sessionExerciseId,
      f.source_fact_id AS sourceFactId, f.reps AS repsRaw, f.weight AS weightRaw,
      ${optional("f", "deleted_at", setColumns)} AS setDeletedAtRaw,
      ${optional("s", "deleted_at", sessionColumns)} AS sessionDeletedAtRaw,
      ${optional("e", "deleted_at", exerciseColumns)} AS exerciseDeletedAtRaw,
      ${optional("f", "completed_at", setColumns)} AS completedAtRaw,
      ${optional("s", "performed_at", sessionColumns)} AS performedAtRaw
    FROM training_session_sets f
    LEFT JOIN training_session_exercises e ON e.id=f.session_exercise_id
    LEFT JOIN training_sessions s ON s.id=e.session_id
    ORDER BY f.id`).all() as unknown as RawLegacySetRow[];
  const physicalCount = db.prepare("SELECT count(*) AS count FROM training_session_sets").get() as { count: number };
  if (rows.length !== physicalCount.count) throw new Error("R04_SOURCE_ROW_CARDINALITY_MISMATCH");
  return rows.map((row): LegacySetSource => {
    const sourceRowId = textOrNull(row.sourceRowId);
    const clientId = textOrNull(row.clientId);
    const programId = textOrNull(row.programId);
    const sessionId = textOrNull(row.sessionId);
    const sessionExerciseId = textOrNull(row.sessionExerciseId);
    if (!sourceRowId || !clientId || !programId || !sessionId || !sessionExerciseId) {
      throw new Error("R04_SOURCE_PROVENANCE_INCOMPLETE");
    }
    return {
      accountScope, sourceRowId, clientId, programId, sessionId, sessionExerciseId,
      sourceFactId: textOrNull(row.sourceFactId),
      repsRaw: textOrNull(row.repsRaw),
      weightRaw: textOrNull(row.weightRaw),
      lifecycleShapeComplete,
      setDeletedAtRaw: textOrNull(row.setDeletedAtRaw),
      sessionDeletedAtRaw: textOrNull(row.sessionDeletedAtRaw),
      exerciseDeletedAtRaw: textOrNull(row.exerciseDeletedAtRaw),
      completedAtRaw: textOrNull(row.completedAtRaw),
      performedAtRaw: textOrNull(row.performedAtRaw),
    };
  });
}
