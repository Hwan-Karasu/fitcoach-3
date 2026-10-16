import type { DatabaseSync } from "node:sqlite";

export interface LegacySemanticScreen {
  /** Coverage of these probes only. Complete does not mean that a source fact is true. */
  readonly coverage: "complete" | "incomplete-shape";
  readonly sourceSessionRows: number | null;
  readonly sourceSetRows: number | null;
  readonly sessionsWithoutExercises: number | null;
  readonly sessionsWithoutSets: number | null;
  readonly exercisesWithoutSets: number | null;
  readonly sourceHistoryRows: number | null;
  readonly historyWithoutMatchingSet: number | null;
  readonly historyMatchingMultipleSets: number | null;
}

const required: Readonly<Record<string, readonly string[]>> = {
  training_sessions: ["id", "client_id"],
  training_session_exercises: ["id", "session_id"],
  training_session_sets: ["session_exercise_id", "source_fact_id"],
  training_exercise_history: ["client_id", "source_fact_id"],
};

/** Structural warning signals only. No row is promoted to a verified performed set. */
export function screenLegacySemantics(db: DatabaseSync): LegacySemanticScreen {
  db.exec("PRAGMA query_only = ON");
  const shape = Object.entries(required).map(([table, columns]) => {
    const actual = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    return columns.every((column) => actual.has(column));
  });
  const [sessions, exercises, sets, history] = shape;
  const count = (sql: string): number => (db.prepare(sql).get() as { count: number }).count;
  const sourceSessionRows = sessions ? count("SELECT count(*) AS count FROM training_sessions") : null;
  const sourceSetRows = sets ? count("SELECT count(*) AS count FROM training_session_sets") : null;
  const sessionsWithoutExercises = sessions && exercises ? count(`SELECT count(*) AS count FROM training_sessions s
    WHERE NOT EXISTS (SELECT 1 FROM training_session_exercises e WHERE e.session_id=s.id)`) : null;
  const sessionsWithoutSets = sessions && exercises && sets ? count(`SELECT count(*) AS count FROM training_sessions s
    WHERE NOT EXISTS (SELECT 1 FROM training_session_exercises e
      JOIN training_session_sets f ON f.session_exercise_id=e.id WHERE e.session_id=s.id)`) : null;
  const exercisesWithoutSets = exercises && sets ? count(`SELECT count(*) AS count FROM training_session_exercises e
    WHERE NOT EXISTS (SELECT 1 FROM training_session_sets f WHERE f.session_exercise_id=e.id)`) : null;
  const sourceHistoryRows = history ? count("SELECT count(*) AS count FROM training_exercise_history") : null;
  let historyWithoutMatchingSet: number | null = null;
  let historyMatchingMultipleSets: number | null = null;
  if (sessions && exercises && sets && history) {
    const result = db.prepare(`WITH set_refs AS (
        SELECT s.client_id, f.source_fact_id, count(*) AS matches
        FROM training_session_sets f
        JOIN training_session_exercises e ON e.id=f.session_exercise_id
        JOIN training_sessions s ON s.id=e.session_id
        WHERE trim(f.source_fact_id)<>''
        GROUP BY s.client_id, f.source_fact_id
      ) SELECT
        coalesce(sum(CASE WHEN r.matches IS NULL THEN 1 ELSE 0 END),0) AS unmatched,
        coalesce(sum(CASE WHEN r.matches>1 THEN 1 ELSE 0 END),0) AS multiple
      FROM training_exercise_history h
      LEFT JOIN set_refs r ON r.client_id=h.client_id AND r.source_fact_id=h.source_fact_id`).get() as {
      unmatched: number; multiple: number;
    };
    historyWithoutMatchingSet = result.unmatched;
    historyMatchingMultipleSets = result.multiple;
  }
  return {
    coverage: shape.every(Boolean) ? "complete" : "incomplete-shape",
    sourceSessionRows, sourceSetRows, sessionsWithoutExercises, sessionsWithoutSets,
    exercisesWithoutSets, sourceHistoryRows, historyWithoutMatchingSet, historyMatchingMultipleSets,
  };
}
