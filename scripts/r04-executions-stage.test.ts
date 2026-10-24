import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyExecutionInSnapshot } from "./r04/LegacyExecutionSourceReader.ts";
import { readLegacyPlansInSnapshot } from "./r04/LegacyPlansSourceReader.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { legacyExecutionDate, mergeLegacyExecutionDates } from "./r04/LegacyExecutionDates.ts";
import { readLegacyMeasurementsSnapshotInSnapshot } from "./r04/LegacyMeasurementSourceReader.ts";

const context = { sourceSha256: "f".repeat(64), accountScope: "execution-synthetic", sourceWorkspaceId: "source-workspace", targetWorkspaceId: "local-trainer" };
const date0 = "2026-03-01T12:00:00.000Z", date1 = "2026-03-08T12:00:00.000Z", imported = "2026-05-01T10:00:00Z";
const options = { clientIdentityRehearsal: { createdAt: imported, profiles: true as const, questionnaires: true as const, workData: true as const,
  exercises: true as const, plans: true as const, templates: true as const, archives: true as const, executions: true as const } };
function allocator() { let n = 0; return () => `55555555-5555-4555-8555-${String(++n).padStart(12, "0")}`; }
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
function seed(db: DatabaseSync) {
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
    db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,NULL,NULL,'','','','',?)").run(client, context.sourceWorkspaceId, `Синтетический ${client}`, date0, date0,
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
function cache(db: DatabaseSync, id: string, fact: string, date: string, dateSource: string, workout: string | null, reps: string, weight: string, snapshotId?: string) {
  db.prepare("INSERT INTO training_sessions VALUES(?,'a',?,'old-program','old-week','Проекция',?,?,'{}',NULL)").run(id, workout, date, dateSource);
  db.prepare("INSERT INTO training_session_exercises VALUES(?,?,NULL,'x','catalog:x','Имя проекции',0,'{}',NULL)").run(`e-${id}`, id);
  db.prepare("INSERT INTO training_session_sets VALUES(?,?,?,0,?,?,'8','working','normal',?,?,'{}',NULL)").run(`f-${id}`, `e-${id}`, fact, reps, weight, date, JSON.stringify([{ reps, weight }]));
  if (snapshotId !== undefined) db.prepare("UPDATE training_sessions SET data_json=? WHERE id=?").run(JSON.stringify({ sourcePriority: 2, sourceVersionId: snapshotId }), id);
}
function addWorkoutLog(db: DatabaseSync, value: unknown, id = "old-log", client = "a", workout = "w-a0", deleted: string | null = null) {
  db.exec("CREATE TABLE IF NOT EXISTS training_workout_logs(id TEXT PRIMARY KEY,client_id TEXT,workout_id TEXT,logged_at TEXT,data_json TEXT,deleted_at TEXT)");
  db.prepare("INSERT INTO training_workout_logs VALUES(?,?,?,?,?,?)").run(id, client, workout, date1, JSON.stringify(value), deleted);
}
function oldWorkoutLog(reps: string | number = "20", weight: string | number = "10") {
  return { status: "completed", workoutName: "Снимок до перестройки", date: date0,
    exercises: [{ exerciseId: "e-a0", name: "Имя старого снимка", catalogId: "x", sets: [{ reps, weight, rpe: "8", completedAt: date0 }] }] };
}
function read(db: DatabaseSync) {
  const catalog = readLegacyExerciseCatalogInSnapshot(db, context.accountScope);
  return { cards: readLegacyClientCardsInSnapshot(db, context.accountScope, readLegacyClientIdentityInSnapshot(db, context.accountScope)), catalog,
    refs: readLegacyExerciseReferencesInSnapshot(db, context.accountScope, catalog), plans: readLegacyPlansInSnapshot(db, context.accountScope), executions: readLegacyExecutionInSnapshot(db, context.accountScope) };
}
function stage(source: DatabaseSync, target: DatabaseSync) {
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  return { input, ledger, result: ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, allocator()) };
}
async function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void | Promise<void>) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source); await run(source, target); } finally { source.close(); target.close(); }
}
function fact(target: DatabaseSync, sourceId: string, client = "a") {
  return target.prepare("SELECT * FROM r04_execution_facts WHERE source_identity_key=?").get(JSON.stringify([context.accountScope, client, "EXPLICIT", sourceId]))!;
}
function workoutContext(target: DatabaseSync, table: string, id: string, path?: string) {
  const row = target.prepare("SELECT * FROM r04_execution_contexts WHERE source_key=?")
    .get(JSON.stringify([context.accountScope, table, id, ...(path === undefined ? [] : [path])]));
  assert.ok(row); return row;
}
type Note = { present: boolean; value: string | null };
const contextDiary = (row: Record<string, unknown>) => JSON.parse(row.diary_json as string) as {
  workoutNote: Note | null; exerciseNotes: { sourceKey: string; diaryNote: Note | null }[]; compatibility: string[] };
const contextState = (row: Record<string, unknown>) => JSON.parse(row.state_json as string) as {
  stored: Note; derived: string | null; completedSets: number | null; totalSets: number | null; targetOutcome: null; basis: string; issues: string[] };
const ownTables = ["clients", "questionnaire_versions", "questionnaire_answers", "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_receipt",
  "r04_exercise_ids", "r04_exercise_registry", "exercise_overlay", "r04_exercise_links", "r04_exercise_receipt", "r04_plan_ids", "r04_plan_source", "r04_plan_receipt",
  "training_programs", "training_program_members", "training_mesocycles", "training_weeks", "training_workouts", "training_planned_exercises", "training_planned_sets", "training_simple_overrides", "training_templates",
  "r04_execution_ids", "r04_execution_sessions", "r04_execution_facts", "r04_execution_segments", "r04_execution_representations", "r04_execution_contexts", "r04_execution_receipt"];

test("measurement failure rolls back nonempty questionnaire, work data, plans and performed facts; retry commits all owners together", async () => {
  for (const phase of ["after-measurement-ids", "after-measurement-rows", "after-measurement-receipt", "before-commit"] as const) await fixture((source, target) => {
    source.exec(`CREATE TABLE client_measurements(id TEXT PRIMARY KEY,client_id TEXT,date_key TEXT,neck TEXT,shoulders TEXT,chest TEXT,waist TEXT,hips TEXT,upper_arm TEXT,thigh TEXT,calf TEXT);
      INSERT INTO client_measurements VALUES('measure','a','2026-03-01','35.5',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
      CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT);
      INSERT INTO client_day_facts VALUES('a','2026-03-01','80.1','1234','Да')`);
    const data = read(source), measurements = readLegacyMeasurementsSnapshotInSnapshot(source, context.accountScope);
    const ledger = prepareCandidateIdentityLedger(target, context, { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, measurements: { referenceDay: "2026-05-01" } } });
    assert.throws(() => ledger.stageClientMeasurements(data.cards, null, data.catalog, data.refs, data.plans, data.executions, measurements, allocator(), (p) => {
      if (p === phase) throw new Error("injected");
    }), /WRITE_FAILED/u);
    for (const table of [...ownTables, "body_measurements", "measurement_daily_primary", "r04_measurement_ids", "r04_measurement_receipt"]) {
      assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    }
    assert.equal(target.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()?.n, 0);
    const result = ledger.stageClientMeasurements(data.cards, null, data.catalog, data.refs, data.plans, data.executions, measurements, allocator());
    assert.equal(result.performedFacts, 5); assert.equal(result.measurementRows, 2); assert.equal(result.weightMeasurementRows, 1); assert.equal(ledger.loadMeasurementDraftFacts().length, 2);
  });
});

test("canonical facts deduplicate current/session/history/archive mirrors once per client, without merging identical other weeks", () => fixture((source, target) => {
  const { result, ledger } = stage(source, target);
  assert.equal(result.performedFacts, 5); assert.equal(result.canonicalSessions, 3); assert.equal(result.executionRepresentations, 12);
  assert.equal(result.status, "training-executions-rehearsal-staged"); assert.equal(result.finalizable, false);
  const first = fact(target, "set-a0"), second = fact(target, "set-a1"), otherClient = fact(target, "set-a0", "b");
  assert.notEqual(first.id, second.id); assert.notEqual(first.session_id, second.session_id); assert.notEqual(first.id, otherClient.id);
  assert.equal(first.reps, 20); assert.equal(first.load_grams, 10000); assert.equal(first.actual_timestamp, date0);
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_execution_representations WHERE fact_id=?").get(first.id!)?.n, 5);
  assert.equal(first.snapshot_name, "Историческое имя"); assert.ok((JSON.parse(first.names_json as string) as string[]).includes("Архивное имя"));
  assert.equal(ledger.loadExecutionDraftFacts().length, 5); assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("a workout snapshot joins only its observed cache ID and preserves the entire old snapshot without adding a duplicate fact", () => fixture((source, target) => {
  const raw = oldWorkoutLog(); addWorkoutLog(source, raw);
  cache(source, "log-cache", "old-log:e-a0:0", date0, "completed-at", "w-a0", "20", "10", "old-log");
  const { result, ledger } = stage(source, target), f = fact(target, "old-log:e-a0:0"), c = workoutContext(target, "training_workout_logs", "old-log");
  assert.equal(result.performedFacts, 6); assert.equal(result.executionContexts, 8);
  const rows = target.prepare("SELECT * FROM r04_execution_representations WHERE fact_id=?").all(f.id!);
  assert.equal(rows.length, 2); assert.deepEqual(rows.map((r) => r.source_kind).sort(), ["SESSION", "SNAPSHOT"]);
  assert.equal(c.session_id, f.session_id); assert.equal(c.source_kind, "SNAPSHOT");
  assert.deepEqual(JSON.parse((JSON.parse(c.source_json as string) as { data_json: string }).data_json), raw);
  assert.equal(contextState(c).targetOutcome, null); assert.equal(contextState(c).derived, null);
  assert.ok((JSON.parse(f.names_json as string) as string[]).includes("Имя старого снимка"));
  assert.equal(ledger.loadExecutionDraftFacts().length, 6); assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("uncorroborated snapshot metrics and completion-like fields remain editable values, never manufactured facts or dates", () => fixture((source, target) => {
  addWorkoutLog(source, oldWorkoutLog(20, 2.5));
  const { result } = stage(source, target), c = workoutContext(target, "training_workout_logs", "old-log");
  const r = target.prepare("SELECT * FROM r04_execution_representations WHERE source_kind='SNAPSHOT'").get()!;
  const detail = JSON.parse(r.context_json as string) as { sourceFactId: string | null; editable: { confirmed: boolean; values: { reps: number; loadGrams: number } }; completionBasis: string };
  assert.equal(result.performedFacts, 5); assert.equal(r.fact_id, null); assert.equal(r.disposition, "UNCONFIRMED");
  assert.equal(detail.sourceFactId, null); assert.equal(detail.completionBasis, "SNAPSHOT_COMPLETION_NOT_PROVEN");
  assert.equal(detail.editable.confirmed, false); assert.deepEqual([detail.editable.values.reps, detail.editable.values.loadGrams], [20, 2500]);
  assert.equal((JSON.parse(r.date_json as string) as { precision: string }).precision, "UNKNOWN");
  assert.equal(contextState(c).targetOutcome, null); assert.equal(contextState(c).completedSets, null);
}));

test("numeric snapshot mini-sets agree exactly with numeric JSON retained in the old canonical cache", () => fixture((source, target) => {
  addWorkoutLog(source, { exercises: [{ exerciseId: "e-a0", catalogId: "x", sets: [{ reps: 20, weight: 2.5, rpe: 8, setKind: "drop", effortOutcome: "failure",
    segments: [{ reps: 20, weight: 2.5 }, { reps: 10, weight: 1.25 }] }] }] });
  cache(source, "log-cache", "old-log:e-a0:0", date0, "completed-at", "w-a0", "20", "2.5", "old-log");
  source.prepare("UPDATE training_session_sets SET set_kind='drop',effort_outcome='failure',segments_json=? WHERE id='f-log-cache'")
    .run(JSON.stringify([{ reps: 20, weight: 2.5 }, { reps: 10, weight: 1.25 }]));
  const { result } = stage(source, target), f = fact(target, "old-log:e-a0:0");
  assert.equal(result.performedFacts, 6); assert.equal(f.load_grams, 2500); assert.equal(f.effort_outcome, "failure");
  assert.deepEqual(target.prepare("SELECT reps,load_grams FROM r04_execution_segments WHERE fact_id=? ORDER BY position").all(f.id!).map((r) => ({ ...r })),
    [{ reps: 20, load_grams: 2500 }, { reps: 10, load_grams: 1250 }]);
}));

test("object exercise maps, direct set arrays and escaped physical paths survive without name or value deduplication", () => fixture((source, target) => {
  addWorkoutLog(source, { exercises: { "e/~": [{ reps: "20", weight: "10" }], second: { id: "old-instance", exerciseName: "Старое имя", sets: [{ reps: "20", weight: "10" }] } } });
  const { result } = stage(source, target), rows = target.prepare("SELECT * FROM r04_execution_representations WHERE source_kind='SNAPSHOT' ORDER BY source_key").all();
  assert.equal(result.performedFacts, 5); assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => (JSON.parse(r.source_key as string) as string[])[3]), ["/exercises/e~1~0/0", "/exercises/second/sets/0"]);
  assert.ok(rows.every((r) => r.fact_id === null));
  const c = workoutContext(target, "training_workout_logs", "old-log"); assert.equal(contextState(c).totalSets, 2);
}));

test("matching snapshot values cannot hide a cache conflict or merge a different physical workout", async () => {
  for (const wrongWorkout of [false, true]) await fixture((source, target) => {
    addWorkoutLog(source, oldWorkoutLog());
    cache(source, "log-cache", "old-log:e-a0:0", date0, "completed-at", wrongWorkout ? "w-a1" : "w-a0", "20", wrongWorkout ? "10" : "11", "old-log");
    assert.throws(() => stage(source, target), wrongWorkout ? /SNAPSHOT_CACHE_REFERENCE_CONFLICT/u : /FACT_VALUE_CONFLICT/u);
    for (const table of ownTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
  });
});

test("source-version metadata disambiguates colon-concatenated IDs from different logs", () => fixture((source, target) => {
  addWorkoutLog(source, { exercises: [{ exerciseId: "part:exercise", catalogId: "x", sets: [{ reps: "20", weight: "10", rpe: "8" }] }] }, "log");
  addWorkoutLog(source, { exercises: [{ exerciseId: "exercise", catalogId: "x", sets: [{ reps: "20", weight: "10", rpe: "8" }] }] }, "log:part");
  cache(source, "log-cache", "log:part:exercise:0", date0, "completed-at", "w-a0", "20", "10", "log");
  stage(source, target);
  const rows = target.prepare("SELECT * FROM r04_execution_representations WHERE source_kind='SNAPSHOT' ORDER BY source_key").all();
  assert.deepEqual(rows.map((r) => r.disposition), ["PERFORMED", "UNCONFIRMED"]);
  assert.equal(rows[1]!.fact_id, null);
}));

test("duplicate exercise IDs within one snapshot cannot identify two physical sets even if values match", () => fixture((source, target) => {
  const exercise = { exerciseId: "same", catalogId: "x", sets: [{ reps: "20", weight: "10" }] };
  addWorkoutLog(source, { exercises: [exercise, exercise] });
  cache(source, "log-cache", "old-log:same:0", date0, "completed-at", "w-a0", "20", "10", "old-log");
  assert.throws(() => stage(source, target), /SNAPSHOT_ID_AMBIGUOUS/u);
  assert.equal(target.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
}));

test("snapshots preserve deleted unreadable rows, absent workouts and templates without reviving their facts", async () => {
  for (const mode of ["deleted", "missing", "template"] as const) await fixture((source, target) => {
    const workout = mode === "missing" ? "no-longer-present" : "w-b0";
    addWorkoutLog(source, oldWorkoutLog(), "old-log", "b", workout, mode === "deleted" ? date1 : null);
    if (mode === "deleted") source.exec("UPDATE training_workout_logs SET data_json='broken old JSON'");
    if (mode === "template") source.prepare("UPDATE training_programs SET is_template=1,template_workspace_id=? WHERE id='p-b'").run(context.sourceWorkspaceId);
    stage(source, target); const c = workoutContext(target, "training_workout_logs", "old-log");
    assert.equal(c.lifecycle, mode === "deleted" ? "DELETED" : mode === "template" ? "TEMPLATE" : "ACTIVE");
    assert.equal(contextState(c).targetOutcome, null);
    assert.equal(target.prepare("SELECT count(*) AS n FROM r04_execution_representations WHERE source_kind='SNAPSHOT' AND disposition='PERFORMED'").get()?.n, 0);
    if (mode === "deleted") assert.equal((JSON.parse(c.source_json as string) as { data_json: string }).data_json, "broken old JSON");
    if (mode === "missing") assert.equal(c.session_id, null);
  });
});

test("invalid active snapshot shapes and foreign clients roll back all owners instead of silently losing sets", async () => {
  for (const mode of ["json", "exercises", "sets", "segments", "foreign", "owner"] as const) await fixture((source, target) => {
    addWorkoutLog(source, mode === "exercises" ? {} : mode === "sets" ? { exercises: [{}] } : mode === "segments" ? { exercises: [{ sets: [{ segments: {} }] }] } : oldWorkoutLog(),
      "old-log", mode === "owner" ? "unknown-client" : "a", mode === "foreign" ? "w-b0" : "w-a0");
    if (mode === "json") source.exec("UPDATE training_workout_logs SET data_json='{'");
    assert.throws(() => stage(source, target), /METRIC_JSON_INVALID|SNAPSHOT_(?:EXERCISES|SETS|SEGMENTS)_INVALID|FOREIGN_WORKOUT|OWNER_OR_COVERAGE_INVALID/u);
    for (const table of ownTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
  });
});

test("numeric JSON tokens retain their exact decimal text instead of rounding to an apparently valid weight", () => fixture((source, target) => {
  addWorkoutLog(source, { exercises: [{ sets: [{ reps: 20, weight: 0.1 }] }] });
  source.exec("UPDATE training_workout_logs SET data_json=replace(data_json,'0.1','0.10000000000000001')");
  stage(source, target);
  const row = target.prepare("SELECT * FROM r04_execution_representations WHERE source_kind='SNAPSHOT'").get()!;
  const detail = JSON.parse(row.context_json as string) as { editable: { values: { loadGrams: number | null }; issues: string[] } };
  assert.equal(detail.editable.values.loadGrams, null); assert.ok(detail.editable.issues.includes("BASE_INVALID_WEIGHT"));
  assert.equal((JSON.parse(row.source_json as string) as { set: { weight: string } }).set.weight, "0.10000000000000001");
}));

test("a snapshot cannot revive a deleted cache projection or obtain its fact ID from another client", async () => {
  for (const mode of ["deleted-cache", "other-client"] as const) await fixture((source, target) => {
    addWorkoutLog(source, oldWorkoutLog());
    cache(source, "log-cache", "old-log:e-a0:0", date0, "completed-at", "w-a0", "20", "10", "old-log");
    if (mode === "deleted-cache") source.prepare("UPDATE training_session_sets SET deleted_at=? WHERE id='f-log-cache'").run(date1);
    else source.exec("UPDATE training_sessions SET client_id='b',source_workout_id='w-b0' WHERE id='log-cache'");
    const { result } = stage(source, target);
    const r = target.prepare("SELECT * FROM r04_execution_representations WHERE source_kind='SNAPSHOT'").get()!;
    assert.equal(result.performedFacts, mode === "deleted-cache" ? 5 : 6); assert.equal(r.disposition, "UNCONFIRMED"); assert.equal(r.fact_id, null);
    if (mode === "other-client") assert.equal((JSON.parse(r.context_json as string) as { sourceFactId: string | null }).sourceFactId, null);
  });
});

test("older snapshot coverage cannot be asserted by omitting its manifest version", () => fixture((source, target) => {
  addWorkoutLog(source, oldWorkoutLog()); const { ledger } = stage(source, target);
  target.exec("UPDATE r04_execution_receipt SET target_json=json_remove(target_json,'$.snapshotProjectionVersion')");
  assert.throws(() => ledger.loadExecutionDraftContexts(), /PARITY_MISMATCH/u);
}));

test("a matching cache set ID alone cannot invent snapshot origin; direct arrays can use the proven cache catalog", async () => {
  for (const origin of ["missing", "different-log", "proved"] as const) await fixture((source, target) => {
    addWorkoutLog(source, { exercises: { "e-a0": [{ reps: "20", weight: "10", rpe: "8" }] } });
    cache(source, "log-cache", "old-log:e-a0:0", date0, "completed-at", "w-a0", "20", "10", origin === "missing" ? undefined : origin === "proved" ? "old-log" : "other-log");
    stage(source, target); const r = target.prepare("SELECT * FROM r04_execution_representations WHERE source_kind='SNAPSHOT'").get()!;
    assert.equal(r.disposition, origin === "proved" ? "PERFORMED" : "UNCONFIRMED");
    assert.equal(r.fact_id === null, origin !== "proved");
  });
});

test("notes-only workout keeps owner/plan/long diary notes without creating a performed session or trusting stored completion", () => fixture((source, target) => {
  const long = "Точная заметка без обрезки. ".repeat(90);
  source.exec("ALTER TABLE training_workouts ADD COLUMN status TEXT; UPDATE training_set_logs SET reps='',weight='',completed_at=NULL WHERE id='set-b0'");
  source.prepare("UPDATE training_workouts SET status='completed',data_json=? WHERE id='w-b0'").run(JSON.stringify({ note: "Заметка ко всей тренировке" }));
  source.prepare("UPDATE training_exercises SET note='Указание плана',data_json=? WHERE id='e-b0'").run(JSON.stringify({ catalogId: "x", diaryNote: long }));
  const { result, ledger } = stage(source, target), row = workoutContext(target, "training_workouts", "w-b0"), state = contextState(row), notes = contextDiary(row);
  assert.equal(result.performedFacts, 4); assert.equal(result.canonicalSessions, 2); assert.equal(result.executionContexts, 6);
  assert.equal(row.session_id, null); assert.equal(row.lifecycle, "ACTIVE");
  assert.equal(row.client_id, ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "b"])));
  assert.ok((JSON.parse(row.plan_json as string) as { targetId: string }).targetId);
  assert.equal(notes.workoutNote!.value, "Заметка ко всей тренировке"); assert.equal(notes.exerciseNotes[0]!.diaryNote!.value, long);
  assert.deepEqual(notes.compatibility, ["D01_WORKOUT_NOTE_FIELD_REQUIRED", "D01_NOTE_LIMIT"]);
  assert.deepEqual([state.stored.value, state.derived, state.completedSets, state.totalSets, state.targetOutcome], ["completed", "planned", 0, 1, null]);
  assert.ok(state.issues.includes("STORED_AND_DERIVED_STATUS_DIFFER"));
  assert.equal((JSON.parse(row.source_json as string) as { exercises: { note: string }[] }).exercises[0]!.note, "Указание плана");
  assert.equal(ledger.loadExecutionDraftContexts().length, 6); assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("a free workout with no exercises or facts retains its note and stable context without inventing plan bindings", () => fixture((source, target) => {
  source.prepare("INSERT INTO training_workouts VALUES('free-empty','a',NULL,NULL,0,'Без программы',?,?,?,NULL)")
    .run(JSON.stringify({ note: "Записано до составления плана" }), date0, date0);
  const { result, ledger } = stage(source, target), row = workoutContext(target, "training_workouts", "free-empty");
  assert.equal(result.performedFacts, 5); assert.equal(result.canonicalSessions, 3); assert.equal(result.executionContexts, 7);
  assert.equal(row.session_id, null); assert.equal(contextDiary(row).workoutNote!.value, "Записано до составления плана");
  assert.deepEqual(contextDiary(row).exerciseNotes, []); assert.equal(contextState(row).totalSets, 0);
  assert.equal((JSON.parse(row.plan_json as string) as { targetId: string | null }).targetId, null);
  const input = read(source);
  ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, () => { throw new Error("reuse context IDs"); });
  assert.equal(workoutContext(target, "training_workouts", "free-empty").id, row.id);
}));

test("template and deleted workout contexts retain their lifecycle without reviving executions", async () => {
  for (const template of [false, true]) await fixture((source, target) => {
    if (template) {
      source.prepare("UPDATE training_programs SET is_template=1,template_workspace_id=? WHERE id='p-b'").run(context.sourceWorkspaceId);
    } else {
      source.prepare("UPDATE training_workouts SET deleted_at=?,data_json='{\"note\":4}' WHERE id='w-b0'").run(date1);
    }
    const { result } = stage(source, target), row = workoutContext(target, "training_workouts", "w-b0");
    assert.equal(row.lifecycle, template ? "TEMPLATE" : "DELETED"); assert.equal(row.session_id, null);
    assert.equal(result.performedFacts, 4); assert.equal(contextState(row).targetOutcome, null);
    if (!template) assert.equal(contextDiary(row).workoutNote, null, "удалённое содержимое сохранено raw, не интерпретируется и не воскрешается");
  });
});

test("live and archive diary notes stay separate; verified root/cycle mirrors keep one context and both raw paths", () => fixture((source, target) => {
  source.prepare("UPDATE training_workouts SET data_json=? WHERE id='w-a0'").run(JSON.stringify({ note: "Текущая заметка" }));
  source.prepare("UPDATE training_exercises SET note='Инструкция',data_json=? WHERE id='e-a0'").run(JSON.stringify({ catalogId: "x", diaryNote: "Текущее выполнение" }));
  source.exec(`UPDATE training_archive_entries SET data_json=json_set(data_json,
    '$.workouts[0].data',json('{"note":"Архивная заметка"}'), '$.cycles[0].snapshot.workouts[0].data',json('{"note":"Архивная заметка"}'),
    '$.workouts[0].exercises[0].data.diaryNote','Архивное выполнение', '$.cycles[0].snapshot.workouts[0].exercises[0].data.diaryNote','Архивное выполнение')`);
  stage(source, target);
  const current = workoutContext(target, "training_workouts", "w-a0"), archive = workoutContext(target, "training_archive_entries", "archive", "/cycles/0/snapshot/workouts/0");
  assert.notEqual(current.id, archive.id); assert.equal(current.session_id, archive.session_id, "общие подтверждённые факты не стирают разные контексты заметок");
  assert.equal(contextDiary(current).workoutNote!.value, "Текущая заметка"); assert.equal(contextDiary(archive).workoutNote!.value, "Архивная заметка");
  assert.equal(contextDiary(current).exerciseNotes[0]!.diaryNote!.value, "Текущее выполнение");
  assert.equal(contextDiary(archive).exerciseNotes[0]!.diaryNote!.value, "Архивное выполнение");
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_execution_contexts WHERE source_kind='ARCHIVE'").get()?.n, 2);
  const raw = JSON.parse(archive.source_json as string) as { mirror: { sourceKey: string; workout: { data: { note: string } } } };
  assert.equal(raw.mirror.sourceKey, JSON.stringify([context.accountScope, "training_archive_entries", "archive", "/workouts/0"]));
  assert.equal(raw.mirror.workout.data.note, "Архивная заметка");
}));

test("contexts retain legacy status evidence and never turn cache/unknown labels into a v3 outcome", () => fixture((source, target) => {
  source.exec("ALTER TABLE training_workouts ADD COLUMN status TEXT; UPDATE training_workouts SET status='missed' WHERE id='w-b0'");
  stage(source, target);
  const current = contextState(workoutContext(target, "training_workouts", "w-b0"));
  assert.deepEqual([current.stored.value, current.derived, current.completedSets, current.targetOutcome], ["missed", "completed", 1, null]);
  assert.ok(current.issues.includes("SOURCE_STATUS_REQUIRES_REVIEW"));
  const cache = contextState(workoutContext(target, "training_sessions", "cache"));
  assert.deepEqual([cache.derived, cache.completedSets, cache.totalSets, cache.targetOutcome], [null, null, null, null]);
  assert.equal(cache.basis, "CANONICAL_CACHE_NOT_WORKOUT_OUTCOME");
}));

test("unreadable active note values and a foreign cache reference without facts roll back every owner", async () => {
  for (const sql of ["UPDATE training_workouts SET data_json='{\"note\":4}' WHERE id='w-a0'",
    "UPDATE training_exercises SET data_json='{\"catalogId\":\"x\",\"diaryNote\":4}' WHERE id='e-a0'",
    "DELETE FROM training_session_sets; UPDATE training_sessions SET source_workout_id='w-b0' WHERE id='cache'"]) await fixture((source, target) => {
    source.exec(sql); const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, allocator()), /EXECUTION_CONTEXT_/u);
    for (const table of ownTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
  });
});

test("guarded context reads reject changed notes; changed source cannot overwrite saved contexts", () => fixture((source, target) => {
  const { ledger } = stage(source, target), original = workoutContext(target, "training_workouts", "w-a0");
  target.prepare("UPDATE r04_execution_contexts SET diary_json='{}' WHERE id=?").run(original.id!);
  assert.throws(() => ledger.loadExecutionDraftContexts(), /EXECUTION_PARITY_MISMATCH/u);
  assert.throws(() => ledger.loadExecutionDraftFacts(), /EXECUTION_PARITY_MISMATCH/u);
  target.prepare("UPDATE r04_execution_contexts SET diary_json=? WHERE id=?").run(original.diary_json!, original.id!);
  source.exec("UPDATE training_workouts SET data_json='{\"note\":\"изменено\"}' WHERE id='w-a0'"); const changed = read(source);
  assert.throws(() => ledger.stageClientExecutions(changed.cards, null, changed.catalog, changed.refs, changed.plans, changed.executions, allocator()), /PARITY_MISMATCH/u);
  assert.deepEqual(workoutContext(target, "training_workouts", "w-a0"), original);
}));

test("old execution mode cannot claim the new context schema or omit its manifest version", () => fixture((source, target) => {
  const { ledger } = stage(source, target);
  const binding = target.prepare("SELECT context_json FROM r04_candidate_identity").get()!;
  target.prepare("UPDATE r04_candidate_identity SET context_json=?").run((binding.context_json as string).replace("TRAINING_EXECUTIONS_REHEARSAL_V3", "TRAINING_EXECUTIONS_REHEARSAL_V2"));
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /CONTEXT_MISMATCH/u);
  target.prepare("UPDATE r04_candidate_identity SET context_json=?").run(binding.context_json!);
  target.exec("UPDATE r04_execution_receipt SET target_json=json_remove(target_json,'$.contextProjectionVersion')");
  assert.throws(() => ledger.loadExecutionDraftContexts(), /EXECUTION_PARITY_MISMATCH/u);
  target.exec("DROP TABLE r04_execution_contexts");
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /FOREIGN_DATABASE/u);
}));

test("warmups, DROP mini-sets, failure effort and unconfirmed draft values retain independent semantics", () => fixture((source, target) => {
  stage(source, target); const warmup = fact(target, "warmup"), drop = fact(target, "drop");
  assert.equal(warmup.set_type, "WARMUP"); assert.equal(warmup.load_grams, 0); assert.equal(drop.set_type, "DROP"); assert.equal(drop.effort_outcome, "failure");
  assert.deepEqual(target.prepare("SELECT reps,load_grams FROM r04_execution_segments WHERE fact_id=? ORDER BY position").all(drop.id!).map((r) => ({ ...r })), [{ reps: 20, load_grams: 10000 }, { reps: 15, load_grams: 8000 }]);
  assert.ok((JSON.parse(drop.compatibility_json as string) as string[]).includes("D01_DROP_FAILURE_FIELD_REQUIRED"));
  const draft = target.prepare("SELECT * FROM r04_execution_representations WHERE source_key=?").get(JSON.stringify([context.accountScope, "training_set_logs", "draft"]));
  assert.equal(draft?.disposition, "UNCONFIRMED"); assert.equal(draft?.fact_id, null); assert.equal((JSON.parse(draft!.source_json as string) as Record<string, unknown>).reps, "5");
  assert.equal(target.prepare("SELECT working_facts FROM r04_execution_sessions WHERE id=?").get(warmup.session_id!)?.working_facts, 1);
}));

test("explicit unconfirmed zero values remain editable zeros and never create a performed fact", () => fixture((source, target) => {
  source.exec("UPDATE training_set_logs SET reps='0',weight='0',rpe='9' WHERE id='draft'");
  const before = source.prepare("SELECT * FROM training_set_logs WHERE id='draft'").get();
  const { result, ledger } = stage(source, target);
  const row = target.prepare("SELECT * FROM r04_execution_representations WHERE source_key=?")
    .get(JSON.stringify([context.accountScope, "training_set_logs", "draft"]))!;
  const saved = JSON.parse(row.context_json as string) as { editable: { confirmed: boolean; hasInput: boolean; values: { reps: number; loadGrams: number }; rpe: number; issues: string[] } };
  assert.equal(row.disposition, "UNCONFIRMED"); assert.equal(row.fact_id, null); assert.equal(row.session_id, null);
  assert.deepEqual([saved.editable.confirmed, saved.editable.hasInput, saved.editable.values.reps, saved.editable.values.loadGrams, saved.editable.rpe], [false, true, 0, 0, 9]);
  assert.deepEqual(saved.editable.issues, []); assert.equal(result.performedFacts, 5);
  assert.equal(ledger.loadExecutionDraftFacts().length, 5);
  assert.deepEqual(source.prepare("SELECT * FROM training_set_logs WHERE id='draft'").get(), before);
}));

test("partial DROP drafts retain separate effort/segments, invalid text stays reviewable and plan values never fill blank fields", () => fixture((source, target) => {
  source.exec(`UPDATE training_set_logs SET reps='20',weight='10',set_kind='drop',effort_outcome='failure',rpe='8' WHERE id='draft';
    INSERT INTO training_set_segments VALUES('draft-main','draft',0,'20','10',NULL);
    INSERT INTO training_set_segments VALUES('draft-mini','draft',1,'','8',NULL);
    INSERT INTO training_set_logs VALUES('invalid-draft','e-a0',3,'8x','1.2345','11',NULL,'{"factCompletionExplicit":true}',NULL,'working','normal');
    INSERT INTO training_set_logs VALUES('blank-draft','e-a0',4,'','','',NULL,'{"factCompletionExplicit":true,"plannedReps":"100","plannedWeight":"100"}',NULL,'working','normal');`);
  const { result, ledger } = stage(source, target);
  const draft = (id: string) => {
    const row = target.prepare("SELECT * FROM r04_execution_representations WHERE source_key=?")
      .get(JSON.stringify([context.accountScope, "training_set_logs", id]))!;
    assert.equal(row.disposition, "UNCONFIRMED"); assert.equal(row.fact_id, null);
    return { row, data: JSON.parse(row.context_json as string) as { editable: { confirmed: boolean; hasInput: boolean; values: { reps: number | null; loadGrams: number | null };
      segments: { reps: number | null; loadGrams: number | null }[]; kind: string; effort: string; rpe: number | null; issues: string[] } } };
  };
  const drop = draft("draft").data.editable;
  assert.deepEqual([drop.confirmed, drop.kind, drop.effort, drop.rpe], [false, "drop", "failure", 8]);
  assert.deepEqual(drop.segments.map((s) => [s.reps, s.loadGrams]), [[20, 10000], [null, 8000]]);
  assert.deepEqual(drop.issues, [], "пустое поле — нормальное незавершённое состояние");
  const invalid = draft("invalid-draft");
  assert.deepEqual([invalid.data.editable.values.reps, invalid.data.editable.values.loadGrams, invalid.data.editable.rpe], [null, null, null]);
  assert.deepEqual(invalid.data.editable.issues, ["BASE_INVALID_REPS", "BASE_INVALID_WEIGHT", "RPE_INVALID"]);
  assert.equal(invalid.data.editable.hasInput, true);
  assert.equal((JSON.parse(invalid.row.source_json as string) as { weight: string }).weight, "1.2345");
  const blank = draft("blank-draft").data.editable;
  assert.equal(blank.hasInput, false); assert.equal(blank.values.reps, null); assert.equal(blank.values.loadGrams, null);
  assert.equal(result.performedFacts, 5); assert.equal(result.finalizable, false);
  target.exec("UPDATE r04_execution_representations SET context_json=json_set(context_json,'$.editable.confirmed',1) WHERE disposition='UNCONFIRMED'");
  assert.throws(() => ledger.loadExecutionDraftFacts(), /EXECUTION_PARITY_MISMATCH/u);
}));

test("an older execution receipt cannot claim verified editable projection without its version", () => fixture((source, target) => {
  const { ledger } = stage(source, target);
  target.exec("UPDATE r04_execution_receipt SET target_json=json_remove(target_json,'$.editableProjectionVersion')");
  assert.throws(() => ledger.loadExecutionDraftFacts(), /EXECUTION_PARITY_MISMATCH/u);
  const input = read(source);
  assert.throws(() => ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, allocator()), /EXECUTION_PARITY_MISMATCH/u);
}));

test("imported-unknown markers override cached completion timestamps even when importedAt is missing", () => fixture((source, target) => {
  source.exec("UPDATE training_set_logs SET data_json=json_set(data_json,'$.historyDateStatus','imported-unknown') WHERE exercise_id='e-a0'");
  const { result } = stage(source, target), f = fact(target, "set-a0");
  assert.equal(result.performedFacts, 5); assert.equal(f.date_precision, "UNKNOWN"); assert.equal(f.actual_date, null); assert.equal(f.actual_timestamp, null); assert.equal(f.imported_at, null);
  assert.equal(fact(target, "warmup").actual_date, null);
  assert.equal(target.prepare("SELECT undated_facts,first_known_date FROM r04_execution_sessions WHERE id=?").get(f.session_id!)?.undated_facts, 2);
}));

test("manual exact day correction beats stale import annotations and never invents a completion time", () => fixture((source, target) => {
  source.exec("UPDATE training_set_logs SET data_json=json_set(data_json,'$.historyDateStatus','exact'),completed_at='2026-03-02T12:00:00.000Z' WHERE id='set-a0'");
  stage(source, target); const f = fact(target, "set-a0");
  assert.equal(f.date_precision, "DAY"); assert.equal(f.actual_date, "2026-03-02"); assert.equal(f.actual_timestamp, null);
  assert.ok(target.prepare("SELECT source_json FROM r04_execution_representations WHERE fact_id=? AND source_kind='ARCHIVE' LIMIT 1").get(f.id!)?.source_json?.toString().includes(date0));
}));

test("legacy derived session dates stay estimates; valid large legacy metrics survive outside current D01 limits", () => fixture((source, target) => {
  cache(source, "derived", "derived-fact", "2026-02-01 12:00:00", "derived-week", null, "1000", "1000.001");
  const { result } = stage(source, target), f = fact(target, "derived-fact");
  assert.equal(result.performedFacts, 6); assert.equal(f.date_precision, "DERIVED"); assert.equal(f.actual_date, null); assert.equal(f.estimated_date, "2026-02-01");
  assert.equal(f.reps, 1000); assert.equal(f.load_grams, 1000001); assert.ok((JSON.parse(f.compatibility_json as string) as string[]).includes("D01_METRIC_LIMIT"));
}));

test("calendar days, local date-times and exact timestamp precision remain distinct", () => {
  assert.equal(legacyExecutionDate("2024-02-29", "exact", undefined, undefined).precision, "DAY");
  assert.equal(legacyExecutionDate("2026-03-01 12:01:02.123", undefined, undefined, undefined).precision, "LOCAL_DATETIME");
  assert.equal(mergeLegacyExecutionDates([legacyExecutionDate("2026-03-01T12:01:02.1230", undefined, undefined, undefined),
    legacyExecutionDate("2026-03-01 12:01:02.123", undefined, undefined, undefined)]).precision, "LOCAL_DATETIME");
  const a = legacyExecutionDate("2026-03-01T12:00:00.1234Z", undefined, undefined, undefined), b = legacyExecutionDate("2026-03-01T15:00:00.123400+03:00", undefined, undefined, undefined);
  assert.equal(mergeLegacyExecutionDates([a, b]).precision, "INSTANT");
  assert.throws(() => mergeLegacyExecutionDates([a, legacyExecutionDate("2026-03-01T12:00:00.1235Z", undefined, undefined, undefined)]), /DATE_INVALID_OR_CONFLICTING/u);
  assert.throws(() => legacyExecutionDate("2026-02-29", "exact", undefined, undefined), /DATE_INVALID/u);
  assert.equal(mergeLegacyExecutionDates([a, legacyExecutionDate(null, "imported-unknown", undefined, undefined)]).precision, "UNKNOWN");
});

test("missing historical labels do not discard otherwise proved facts or invent catalog names as snapshots", () => fixture((source, target) => {
  source.exec("UPDATE training_exercises SET name='' WHERE id='e-a0'; UPDATE training_session_exercises SET name=''; UPDATE training_exercise_history SET data_json=json_set(data_json,'$.name','')");
  source.exec("UPDATE training_archive_entries SET data_json=json_set(data_json,'$.workouts[0].exercises[0].name','','$.cycles[0].snapshot.workouts[0].exercises[0].name','')");
  stage(source, target); const row = fact(target, "set-a0"); assert.equal(row.snapshot_name, null); assert.equal(row.reps, 20);
  assert.ok((JSON.parse(row.compatibility_json as string) as string[]).includes("SNAPSHOT_NAME_NOT_OBSERVED"));
}));

test("contradictory values, explicit IDs, current unconfirmation, foreign ownership and invalid segments roll back all owners", async () => {
  for (const sql of ["UPDATE training_session_sets SET reps='21',segments_json='[{\"reps\":\"21\",\"weight\":\"10\"}]' WHERE id='f-cache'",
    "UPDATE training_set_logs SET completed_at=NULL WHERE id='set-a0'",
    "UPDATE training_sessions SET source_workout_id='w-b0' WHERE id='cache'",
    "UPDATE training_session_sets SET rpe='0' WHERE id='f-cache'",
    "UPDATE training_set_segments SET weight='8.0001' WHERE id='drop-mini'",
    "UPDATE training_exercise_history SET data_json=json_set(data_json,'$.sourceFactId','different') WHERE id='h-a0'"]) await fixture((source, target) => {
      source.exec(sql); const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
      assert.throws(() => ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, allocator()), /EXECUTION_/u);
      for (const table of ownTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    });
});

test("deleted current structures cannot erase a fact that survives in history/archive/session representations", () => fixture((source, target) => {
  source.prepare("UPDATE training_set_logs SET deleted_at=? WHERE id='set-a0'").run(date1);
  stage(source, target); const f = fact(target, "set-a0"); assert.ok(f);
  const row = target.prepare("SELECT * FROM r04_execution_representations WHERE source_key=?").get(JSON.stringify([context.accountScope, "training_set_logs", "set-a0"]));
  assert.equal(row?.disposition, "DELETED"); assert.equal(row?.fact_id, f.id);
  assert.ok((JSON.parse(f.compatibility_json as string) as string[]).includes("DELETION_EVIDENCE_REQUIRES_REVIEW"));
}));

test("legacy completed history can recover its original physical ID without a name or metrics lookup", () => fixture((source, target) => {
  source.exec("UPDATE training_exercise_history SET source_fact_id=NULL,data_json=json_remove(data_json,'$.sourceFactId') WHERE id='h-a0'");
  stage(source, target); assert.equal(target.prepare("SELECT count(*) AS n FROM r04_execution_facts").get()?.n, 5);
}));

test("missing archive fact IDs retain one proven root/cycle occurrence but never merge with current facts by identical metrics", () => fixture((source, target) => {
  source.exec("UPDATE training_archive_entries SET data_json=json_remove(data_json,'$.workouts[0].exercises[0].sets[0].sourceFactId','$.cycles[0].snapshot.workouts[0].exercises[0].sets[0].sourceFactId')");
  const { result } = stage(source, target); assert.equal(result.performedFacts, 6);
  const opaque = target.prepare("SELECT * FROM r04_execution_facts WHERE source_fact_id IS NULL").all(); assert.equal(opaque.length, 1);
  assert.ok((JSON.parse(opaque[0]!.compatibility_json as string) as string[]).includes("NO_EXPLICIT_SOURCE_FACT_ID"));
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_execution_representations WHERE fact_id=?").get(opaque[0]!.id!)?.n, 2);
}));

test("archive references to another client's program require independent same-client fact corroboration", async () => {
  for (const corroborated of [false, true]) await fixture((source, target) => {
    source.exec("UPDATE training_archive_entries SET data_json=json_set(data_json,'$.programId','p-b','$.cycles[0].snapshot.programId','p-b')");
    if (!corroborated) source.exec("UPDATE training_archive_entries SET data_json=json_set(data_json,'$.workouts[0].exercises[0].sets[0].sourceFactId','unproved-foreign','$.cycles[0].snapshot.workouts[0].exercises[0].sets[0].sourceFactId','unproved-foreign')");
    const { result } = stage(source, target); assert.equal(result.performedFacts, 5);
    const rows = target.prepare("SELECT * FROM r04_execution_representations WHERE source_kind='ARCHIVE' AND json_extract(context_json,'$.ownership')='ARCHIVE_FOREIGN_PROGRAM'").all();
    assert.equal(rows.length, 2); assert.ok(rows.every((r) => corroborated ? r.fact_id === fact(target, "set-a0").id : r.fact_id === null && r.disposition === "OWNERSHIP_REVIEW"));
    const notes = workoutContext(target, "training_archive_entries", "archive", "/cycles/0/snapshot/workouts/0");
    assert.equal(notes.lifecycle, "OWNERSHIP_REVIEW"); assert.equal(notes.session_id, null);
    assert.notEqual(notes.client_id, workoutContext(target, "training_workouts", "w-b0").client_id);
  });
});

test("a second archive alone cannot authorize facts referencing a known foreign program", () => fixture((source, target) => {
  source.exec("INSERT INTO training_archive_entries SELECT 'owned-copy',client_id,title,data_json,archived_at,deleted_at FROM training_archive_entries");
  source.exec("UPDATE training_archive_entries SET data_json=json_set(data_json,'$.programId','p-b','$.cycles[0].snapshot.programId','p-b') WHERE id='archive'");
  source.exec("DELETE FROM training_set_segments WHERE set_log_id='set-a0'; DELETE FROM training_set_logs WHERE id='set-a0'; DELETE FROM training_session_sets; DELETE FROM training_exercise_history");
  stage(source, target);
  const rows = target.prepare("SELECT * FROM r04_execution_representations WHERE source_kind='ARCHIVE' AND json_extract(context_json,'$.ownership')='ARCHIVE_FOREIGN_PROGRAM'").all();
  assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.fact_id === null && r.disposition === "OWNERSHIP_REVIEW")); assert.ok(fact(target, "set-a0"));
}));

test("execution input is frozen before allocator and earlier-owner callbacks run", () => fixture((source, target) => {
  addWorkoutLog(source, oldWorkoutLog());
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  const result = ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, allocator(), (stage) => {
    if (stage === "after-ids") {
      Object.assign(input.executions.tables.training_session_sets![0]!, { reps: "700" });
      Object.assign(input.plans.tables.training_workouts![0]!, { data_json: '{"note":"injected-note"}' });
      Object.assign(input.executions.tables.training_workout_logs![0]!, { data_json: '{"exercises":[]}' });
    }
  });
  assert.equal(result.performedFacts, 5); assert.equal(fact(target, "set-a0").reps, 20);
  assert.ok(ledger.loadExecutionDraftContexts().every((row) => !(row.source_json as string).includes("injected-note")));
  assert.equal(contextState(workoutContext(target, "training_workout_logs", "old-log")).totalSets, 1);
}));

test("all 23 plan/archive/execution transaction checkpoints roll back together and permit a single retry", async () => {
  const phases = ["after-archive-plans", "after-plan-ids", ...Array.from({ length: 11 }, () => "after-plan-rows"), "after-plan-source", "after-plan-receipt",
    "after-execution-ids", "after-execution-sessions", "after-execution-facts", "after-execution-segments", "after-execution-representations", "after-execution-contexts", "after-execution-receipt", "before-commit"];
  for (let n = 0; n < phases.length; n++) await fixture((source, target) => {
    addWorkoutLog(source, oldWorkoutLog());
    cache(source, "log-cache", "old-log:e-a0:0", date0, "completed-at", "w-a0", "20", "10", "old-log");
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options), phase = phases[n]!, occurrence = phases.slice(0, n + 1).filter((p) => p === phase).length; let seen = 0;
    assert.throws(() => ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, allocator(), (stage) => {
      if (stage === phase && ++seen === occurrence) throw new Error("injected");
    }), /WRITE_FAILED/u);
    for (const table of ownTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    assert.equal(target.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()?.n, 0);
    assert.equal(ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, allocator()).performedFacts, 6);
  });
});

test("source and target drift block replay; guarded reads verify facts, segments, provenance and IDs", () => fixture((source, target) => {
  addWorkoutLog(source, oldWorkoutLog());
  const { input, ledger } = stage(source, target), f = fact(target, "set-a0");
  target.prepare("UPDATE r04_execution_facts SET reps=999 WHERE id=?").run(f.id!); assert.throws(() => ledger.loadExecutionDraftFacts(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE r04_execution_facts SET reps=20 WHERE id=?").run(f.id!);
  const receipt = target.prepare("SELECT * FROM r04_execution_receipt").get()!;
  target.prepare("UPDATE r04_execution_receipt SET source_json='{}'").run(); assert.throws(() => ledger.loadExecutionDraftFacts(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE r04_execution_receipt SET source_json=?").run(receipt.source_json!);
  target.prepare("UPDATE r04_execution_receipt SET target_json='null'").run(); assert.throws(() => ledger.loadExecutionDraftFacts(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE r04_execution_receipt SET target_json=?").run(receipt.target_json!);
  source.exec("UPDATE training_session_sets SET data_json='{\"extra\":true}' WHERE id='f-cache'"); const changed = read(source);
  assert.throws(() => ledger.stageClientExecutions(changed.cards, null, changed.catalog, changed.refs, changed.plans, changed.executions, allocator()), /PARITY_MISMATCH/u);
  assert.equal(ledger.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, () => { throw new Error("reuse IDs"); }).performedFacts, 5);
  source.exec("UPDATE training_workout_logs SET logged_at='2026-04-02T00:00:00Z'"); const changedLogs = read(source);
  assert.throws(() => ledger.stageClientExecutions(changedLogs.cards, null, changedLogs.catalog, changedLogs.refs, changedLogs.plans, changedLogs.executions, allocator()), /PARITY_MISMATCH/u);
}));

test("execution mode cannot claim older archive jobs or bypass the complete entry point", () => fixture((source, target) => {
  const prior = { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, executions: undefined } }, input = read(source);
  prepareCandidateIdentityLedger(target, context, prior).stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator());
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /FOREIGN_DATABASE/u);
  const empty = new DatabaseSync(":memory:"); try {
    const ledger = prepareCandidateIdentityLedger(empty, context, options);
    assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator()), /EXECUTION_MODE_MISMATCH/u);
    assert.equal(empty.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
  } finally { empty.close(); }
}));

test("execution source shape absence stays explicit and partial canonical caches cannot masquerade as complete", () => fixture((source) => {
  source.exec("DROP TABLE training_session_sets"); assert.throws(() => readLegacyExecutionInSnapshot(source, context.accountScope), /PARTIAL_SESSION_STORE/u);
  source.exec("DROP TABLE training_session_exercises; DROP TABLE training_sessions; DROP TABLE training_set_segments");
  const input = readLegacyExecutionInSnapshot(source, context.accountScope); assert.equal(input.tables.training_sessions, null); assert.equal(input.tables.training_set_segments, null);
  assert.equal(input.tables.training_workout_logs, null);
  source.exec("CREATE TABLE training_workout_logs(id TEXT)");
  assert.throws(() => readLegacyExecutionInSnapshot(source, context.accountScope), /SOURCE_SHAPE_UNSUPPORTED/u);
}));

test("read-only source and reopened/reordered canonical executions preserve bytes, source precision and all stable IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-executions-")), sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex"); let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); addWorkoutLog(source, oldWorkoutLog());
    cache(source, "log-cache", "old-log:e-a0:0", date0, "completed-at", "w-a0", "20", "10", "old-log");
    source.close(); source = null; const sourceHash = hash(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN"); const input = read(source), exact = { ...context, sourceSha256: sourceHash };
    target = new DatabaseSync(targetPath); const first = prepareCandidateIdentityLedger(target, exact, options);
    first.stageClientExecutions(input.cards, null, input.catalog, input.refs, input.plans, input.executions, allocator());
    const facts = first.loadExecutionDraftFacts(), contexts = first.loadExecutionDraftContexts(); target.close(); target = null; const targetHash = hash(targetPath); target = new DatabaseSync(targetPath);
    for (const rows of [...Object.values(input.plans.tables), ...Object.values(input.executions.tables)]) if (rows !== null) {
      (rows as Record<string, unknown>[]).reverse();
      for (const [i, row] of rows.entries()) (rows as Record<string, unknown>[])[i] = Object.fromEntries(Object.entries(row).reverse());
    }
    const reopened = prepareCandidateIdentityLedger(target, exact, options);
    assert.equal(reopened.stageClientExecutions([...input.cards].reverse(), null, [...input.catalog].reverse(), [...input.refs].reverse(), input.plans, input.executions, () => { throw new Error("reuse IDs"); }).performedFacts, 6);
    assert.deepEqual(reopened.loadExecutionDraftFacts(), facts); assert.deepEqual(reopened.loadExecutionDraftContexts(), contexts);
    target.close(); target = null; assert.equal(hash(targetPath), targetHash);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), sourceHash);
  } finally { target?.close(); source?.close(); rmSync(dir, { recursive: true, force: true }); }
});
