import type { DatabaseSync } from "node:sqlite";

/** Synthetic source graph shared by host and asynchronous execution writer contracts. */
export const date0 = "2026-03-01T12:00:00.000Z", date1 = "2026-03-08T12:00:00.000Z";
function snapshot(id: string, fact: string, date: string) {
  return { programId: id, mode: "periodized", cycleType: "hypertrophy", settings: { totalWeeks: 1 }, totalWeeks: 1, totalWorkouts: 1, completedWorkouts: 1,
    weeks: [{ weekId: `${id}:week`, weekIndex: 0, weekType: "", label: "Неделя 1", workoutCount: 1 }],
    workouts: [{ name: "Архивная тренировка", weekIndex: 0, sortIndex: 0, status: "completed", exercises: [
      { name: "Архивное имя", note: "", sortIndex: 0, templateExerciseId: "x", data: { catalogId: "x" }, sets: [
        { sourceFactId: fact, setIndex: 0, reps: "20", weight: "10", rpe: "8", completedAt: date, setKind: "working", effortOutcome: "normal",
          segments: [{ reps: "20", weight: "10" }], data: { factCompletionExplicit: true, plannedReps: "8-12", plannedWeight: "2,5" } },
      ] },
    ] }],
  };
}
export function seed(db: DatabaseSync, workspace = "source-workspace") {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT);
    CREATE TABLE exercise_catalog(id TEXT PRIMARY KEY,name TEXT,category TEXT,equipment TEXT,aliases_json TEXT,source TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_programs(id TEXT PRIMARY KEY,client_id TEXT,mode TEXT,name TEXT,cycle_type TEXT,settings_json TEXT,book_id TEXT,is_template INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT,template_workspace_id TEXT);
    CREATE TABLE training_weeks(id TEXT PRIMARY KEY,program_id TEXT,week_index INTEGER,week_type TEXT,label TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_workouts(id TEXT PRIMARY KEY,client_id TEXT,program_id TEXT,week_id TEXT,sort_index INTEGER,name TEXT,data_json TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_exercises(id TEXT PRIMARY KEY,workout_id TEXT,sort_index INTEGER,name TEXT,note TEXT,template_exercise_id TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_set_logs(id TEXT PRIMARY KEY,exercise_id TEXT,set_index INTEGER,reps TEXT,weight TEXT,rpe TEXT,completed_at TEXT,data_json TEXT,deleted_at TEXT,set_kind TEXT,effort_outcome TEXT);
    CREATE TABLE training_set_segments(id TEXT PRIMARY KEY,set_log_id TEXT,segment_index INTEGER,reps TEXT,weight TEXT,deleted_at TEXT);
    CREATE TABLE training_exercise_history(id TEXT PRIMARY KEY,client_id TEXT,exercise_key TEXT,source_fact_id TEXT,data_json TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_archive_entries(id TEXT PRIMARY KEY,client_id TEXT,title TEXT,data_json TEXT,archived_at TEXT,deleted_at TEXT);
    CREATE TABLE training_sessions(id TEXT PRIMARY KEY,client_id TEXT,source_workout_id TEXT,program_key TEXT,week_key TEXT,workout_name TEXT,performed_at TEXT,date_source TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_session_exercises(id TEXT PRIMARY KEY,session_id TEXT,source_exercise_id TEXT,catalog_id TEXT,exercise_key TEXT,name TEXT,sort_index INTEGER,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_session_sets(id TEXT PRIMARY KEY,session_exercise_id TEXT,source_fact_id TEXT,set_index INTEGER,reps TEXT,weight TEXT,rpe TEXT,set_kind TEXT,effort_outcome TEXT,completed_at TEXT,segments_json TEXT,data_json TEXT,deleted_at TEXT);`);
  for (const client of ["a", "b"]) {
    db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,NULL,NULL,'','','','',?)").run(client, workspace, `Синтетический ${client}`, date0, date0,
      JSON.stringify({ trainerNotes: `Заметка ${client}`, trainerTags: ["Общий"] }));
    db.prepare("INSERT INTO training_programs VALUES(?,?,?,?,?, ?,NULL,0,?,?,NULL,NULL)").run(`p-${client}`, client, client === "a" ? "free" : "periodized", `Программа ${client}`, "hypertrophy",
      JSON.stringify({ totalWeeks: client === "a" ? 2 : 1 }), date0, date0);
    for (let i = 0; i < (client === "a" ? 2 : 1); i++) {
      const prefix = `${client}${i}`, time = i === 0 ? date0 : date1;
      db.prepare("INSERT INTO training_weeks VALUES(?,?,?,'','Неделя','{}',NULL)").run(`week-${prefix}`, `p-${client}`, i);
      db.prepare("INSERT INTO training_workouts VALUES(?,?,?,?,0,'Тренировка','{}',?,?,NULL)").run(`w-${prefix}`, client, `p-${client}`, `week-${prefix}`, time, time);
      db.prepare("INSERT INTO training_exercises VALUES(?,?,0,'Текущее имя','','x',?,NULL)").run(`e-${prefix}`, `w-${prefix}`, '{"catalogId":"x"}');
      const set = `set-${prefix}`, data = { factCompletionExplicit: true, plannedReps: "8-12", plannedWeight: "2,5", ...(client === "b" ? { historyOriginId: "set-a0" } : {}) };
      db.prepare("INSERT INTO training_set_logs VALUES(?,?,0,'20','10','8',?,?,NULL,'working','normal')").run(set, `e-${prefix}`, time, JSON.stringify(data));
      db.prepare("INSERT INTO training_set_segments VALUES(?,?,0,'20','10',NULL)").run(`segment-${set}`, set);
    }
  }
  db.prepare("INSERT INTO exercise_catalog VALUES('x','Каталожное имя','Другое','','[]','user',?,?,NULL)").run(date0, date0);
  db.prepare("INSERT INTO training_set_logs VALUES('warmup','e-a0',1,'5','0','',?,'{" + '"factCompletionExplicit":true' + "}',NULL,'warmup','normal')").run(date0);
  db.exec("INSERT INTO training_set_logs VALUES('draft','e-a0',2,'5','','',NULL,'{\"factCompletionExplicit\":true,\"plannedReps\":\"8\"}',NULL,'working','normal')");
  db.prepare("INSERT INTO training_set_logs VALUES('drop','e-a1',1,'20','10','9',?,'{" + '"factCompletionExplicit":true,"plannedReps":"8"' + "}',NULL,'drop','failure')").run(date1);
  db.exec("INSERT INTO training_set_segments VALUES('drop-main','drop',0,'20','10',NULL); INSERT INTO training_set_segments VALUES('drop-mini','drop',1,'15','8',NULL)");
  cache(db, "cache", "set-a0", date0, "completed-at", "w-a0", "20", "10");
  db.prepare("INSERT INTO training_exercise_history VALUES('h-a0','a','catalog:x','set-a0',?,?,NULL)").run(JSON.stringify({ id: "set-a0", sourceFactId: "set-a0", catalogId: "x", exerciseId: "e-a0", name: "Историческое имя",
    workoutId: "w-a0", workoutName: "Тренировка", setIndex: 0, reps: "20", weight: "10", rpe: "8", setKind: "working", effortOutcome: "normal", date: date0, dateStatus: "exact", segments: [{ reps: "20", weight: "10" }] }), date0);
  const cycles = [{ name: "Первый цикл", snapshot: snapshot("old-first", "set-a0", date0) }, { name: "Второй цикл", snapshot: snapshot("old-second", "set-a1", date1) }];
  const root = { ...cycles[0]!.snapshot, totalWeeks: 2, totalWorkouts: 2, completedWorkouts: 2,
    weeks: cycles.flatMap((c, i) => c.snapshot.weeks.map((w) => ({ ...w, weekIndex: i }))),
    workouts: cycles.flatMap((c, i) => c.snapshot.workouts.map((w) => ({ ...w, weekIndex: i }))), cycles };
  db.prepare("INSERT INTO training_archive_entries VALUES('archive','a','Архив',?,?,NULL)").run(JSON.stringify(root), "2026-04-01T10:00:00Z");
}
export function cache(db: DatabaseSync, id: string, fact: string, date: string, dateSource: string, workout: string | null, reps: string, weight: string, snapshotId?: string) {
  db.prepare("INSERT INTO training_sessions VALUES(?,'a',?,'old-program','old-week','Проекция',?,?,'{}',NULL)").run(id, workout, date, dateSource);
  db.prepare("INSERT INTO training_session_exercises VALUES(?,?,NULL,'x','catalog:x','Имя проекции',0,'{}',NULL)").run(`e-${id}`, id);
  db.prepare("INSERT INTO training_session_sets VALUES(?,?,?,0,?,?,'8','working','normal',?,?,'{}',NULL)").run(`f-${id}`, `e-${id}`, fact, reps, weight, date, JSON.stringify([{ reps, weight }]));
  if (snapshotId !== undefined) db.prepare("UPDATE training_sessions SET data_json=? WHERE id=?").run(JSON.stringify({ sourcePriority: 2, sourceVersionId: snapshotId }), id);
}
export function addWorkoutLog(db: DatabaseSync, value: unknown, id = "old-log", client = "a", workout = "w-a0", deleted: string | null = null) {
  db.exec("CREATE TABLE IF NOT EXISTS training_workout_logs(id TEXT PRIMARY KEY,client_id TEXT,workout_id TEXT,logged_at TEXT,data_json TEXT,deleted_at TEXT)");
  db.prepare("INSERT INTO training_workout_logs VALUES(?,?,?,?,?,?)").run(id, client, workout, date1, JSON.stringify(value), deleted);
}
export function oldWorkoutLog(reps: string | number = "20", weight: string | number = "10") {
  return { status: "completed", workoutName: "Снимок до перестройки", date: date0,
    exercises: [{ exerciseId: "e-a0", name: "Имя старого снимка", catalogId: "x", sets: [{ reps, weight, rpe: "8", completedAt: date0 }] }] };
}
