import type { DatabaseSync } from "node:sqlite";

interface RelationProbe {
  readonly id: string;
  readonly shape: Readonly<Record<string, readonly string[]>>;
  readonly sql: string;
}

export interface RelationFinding {
  readonly id: string;
  readonly available: boolean;
  /** Physical source rows with a broken selected relation; not a migrated fact count. */
  readonly sourceRows: number | null;
}

export interface LegacyRelationAudit {
  readonly status: "no-detected-breaks" | "incomplete-shape" | "requires-review";
  readonly findings: readonly RelationFinding[];
}

const probes: readonly RelationProbe[] = [
  { id: "program_client", shape: { training_programs: ["client_id"], clients: ["id"] },
    sql: "SELECT count(*) AS count FROM training_programs p LEFT JOIN clients c ON c.id=p.client_id WHERE c.id IS NULL" },
  { id: "week_program", shape: { training_weeks: ["program_id"], training_programs: ["id"] },
    sql: "SELECT count(*) AS count FROM training_weeks w LEFT JOIN training_programs p ON p.id=w.program_id WHERE p.id IS NULL" },
  { id: "workout_program", shape: { training_workouts: ["program_id"], training_programs: ["id"] },
    sql: "SELECT count(*) AS count FROM training_workouts w LEFT JOIN training_programs p ON p.id=w.program_id WHERE w.program_id IS NOT NULL AND w.program_id<>'' AND p.id IS NULL" },
  { id: "workout_client_mismatch", shape: { training_workouts: ["program_id", "client_id"], training_programs: ["id", "client_id"] },
    sql: "SELECT count(*) AS count FROM training_workouts w JOIN training_programs p ON p.id=w.program_id WHERE w.client_id<>p.client_id" },
  { id: "workout_week", shape: { training_workouts: ["week_id"], training_weeks: ["id"] },
    sql: "SELECT count(*) AS count FROM training_workouts w LEFT JOIN training_weeks tw ON tw.id=w.week_id WHERE w.week_id IS NOT NULL AND w.week_id<>'' AND tw.id IS NULL" },
  { id: "planned_exercise_workout", shape: { training_exercises: ["workout_id"], training_workouts: ["id"] },
    sql: "SELECT count(*) AS count FROM training_exercises e LEFT JOIN training_workouts w ON w.id=e.workout_id WHERE w.id IS NULL" },
  { id: "session_client", shape: { training_sessions: ["client_id"], clients: ["id"] },
    sql: "SELECT count(*) AS count FROM training_sessions s LEFT JOIN clients c ON c.id=s.client_id WHERE c.id IS NULL" },
  { id: "session_exercise_session", shape: { training_session_exercises: ["session_id"], training_sessions: ["id"] },
    sql: "SELECT count(*) AS count FROM training_session_exercises e LEFT JOIN training_sessions s ON s.id=e.session_id WHERE s.id IS NULL" },
  { id: "set_exercise", shape: { training_session_sets: ["session_exercise_id"], training_session_exercises: ["id"] },
    sql: "SELECT count(*) AS count FROM training_session_sets f LEFT JOIN training_session_exercises e ON e.id=f.session_exercise_id WHERE e.id IS NULL" },
  { id: "archive_client", shape: { training_archive_entries: ["client_id"], clients: ["id"] },
    sql: "SELECT count(*) AS count FROM training_archive_entries a LEFT JOIN clients c ON c.id=a.client_id WHERE c.id IS NULL" },
  { id: "appointment_client", shape: { calendar_appointments: ["client_id"], clients: ["id"] },
    sql: "SELECT count(*) AS count FROM calendar_appointments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.client_id IS NOT NULL AND a.client_id<>'' AND c.id IS NULL" },
  { id: "nutrition_client", shape: { nutrition_days: ["client_id"], clients: ["id"] },
    sql: "SELECT count(*) AS count FROM nutrition_days n LEFT JOIN clients c ON c.id=n.client_id WHERE c.id IS NULL" },
  { id: "measurement_client", shape: { client_measurements: ["client_id"], clients: ["id"] },
    sql: "SELECT count(*) AS count FROM client_measurements m LEFT JOIN clients c ON c.id=m.client_id WHERE c.id IS NULL" },
  { id: "history_client", shape: { training_exercise_history: ["client_id"], clients: ["id"] },
    sql: "SELECT count(*) AS count FROM training_exercise_history h LEFT JOIN clients c ON c.id=h.client_id WHERE c.id IS NULL" },
];

/** A structural screen of selected links, not proof that legacy rows are true facts. */
export function auditLegacyRelations(db: DatabaseSync): LegacyRelationAudit {
  db.exec("PRAGMA query_only = ON");
  const columns = new Map<string, ReadonlySet<string>>();
  const tableColumns = (table: string): ReadonlySet<string> => {
    const cached = columns.get(table);
    if (cached) return cached;
    // Table names come only from the fixed probe catalog above.
    const found = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    columns.set(table, found);
    return found;
  };
  const findings = probes.map((probe): RelationFinding => {
    const available = Object.entries(probe.shape).every(([table, required]) =>
      required.every((column) => tableColumns(table).has(column)));
    if (!available) return { id: probe.id, available: false, sourceRows: null };
    const row = db.prepare(probe.sql).get() as { count: number };
    return { id: probe.id, available: true, sourceRows: row.count };
  });
  const status = findings.some((finding) => finding.sourceRows !== null && finding.sourceRows > 0)
    ? "requires-review" : findings.some((finding) => !finding.available)
      ? "incomplete-shape" : "no-detected-breaks";
  return { status, findings };
}
