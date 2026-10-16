import type { DatabaseSync } from "node:sqlite";

export interface SourceFactCollisionAudit {
  /** Physical rows in the legacy table, not verified performed facts. */
  readonly sourceRows: number;
  readonly emptySourceFactIds: number;
  readonly duplicateGroups: number;
  readonly duplicateRows: number;
  readonly crossClientGroups: number;
  readonly crossSessionGroups: number;
  readonly crossProgramGroups: number;
  readonly metricConflictGroups: number;
}

const required: Readonly<Record<string, readonly string[]>> = {
  training_session_sets: ["source_fact_id", "session_exercise_id", "reps", "weight"],
  training_session_exercises: ["id", "session_id"],
  training_sessions: ["id", "client_id", "program_key"],
};

/** Aggregate-only audit. A repeated sourceFactId is evidence to investigate, not a dedup command. */
export function auditSourceFactCollisions(db: DatabaseSync): SourceFactCollisionAudit {
  db.exec("PRAGMA query_only = ON");
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    if (columns.some((column) => !actual.has(column))) throw new Error("SOURCE_FACT_AUDIT_UNSUPPORTED_SHAPE");
  }
  const totals = db.prepare(`SELECT count(*) AS sourceRows,
    sum(CASE WHEN trim(source_fact_id)='' THEN 1 ELSE 0 END) AS emptySourceFactIds
    FROM training_session_sets`).get() as { sourceRows: number; emptySourceFactIds: number | null };
  const collisions = db.prepare(`WITH grouped AS (
      SELECT f.source_fact_id, count(*) AS rowCount,
        count(DISTINCT s.client_id) AS clientCount,
        count(DISTINCT s.id) AS sessionCount,
        count(DISTINCT s.program_key) AS programCount,
        count(DISTINCT json_array(f.reps, f.weight)) AS metricCount
      FROM training_session_sets f
      JOIN training_session_exercises e ON e.id=f.session_exercise_id
      JOIN training_sessions s ON s.id=e.session_id
      WHERE trim(f.source_fact_id)<>''
      GROUP BY f.source_fact_id HAVING count(*)>1
    ) SELECT count(*) AS duplicateGroups,
      coalesce(sum(rowCount),0) AS duplicateRows,
      coalesce(sum(CASE WHEN clientCount>1 THEN 1 ELSE 0 END),0) AS crossClientGroups,
      coalesce(sum(CASE WHEN sessionCount>1 THEN 1 ELSE 0 END),0) AS crossSessionGroups,
      coalesce(sum(CASE WHEN programCount>1 THEN 1 ELSE 0 END),0) AS crossProgramGroups,
      coalesce(sum(CASE WHEN metricCount>1 THEN 1 ELSE 0 END),0) AS metricConflictGroups
    FROM grouped`).get() as Omit<SourceFactCollisionAudit, "sourceRows" | "emptySourceFactIds">;
  return { sourceRows: totals.sourceRows, emptySourceFactIds: totals.emptySourceFactIds ?? 0, ...collisions };
}
