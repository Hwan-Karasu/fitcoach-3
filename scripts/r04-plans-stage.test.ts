import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyPlansInSnapshot } from "./r04/LegacyPlansSourceReader.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { projectLegacyPlanPrescription } from "./r04/LegacyPlanPrescription.ts";
import { readLegacyQuestionnaireInSnapshot } from "./r04/LegacyQuestionnaireSourceReader.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { readMesocycles } from "../apps/mobile/src/features/training/plans/data/PeriodizedStore.ts";
import { readStructure } from "../apps/mobile/src/features/training/plans/data/SimplePlanStore.ts";
import { readSimpleWeeks } from "../apps/mobile/src/features/training/plans/data/SimpleWeekStore.ts";
import { groupOfCopy } from "../apps/mobile/src/features/training/plans/data/MesocycleGroupStore.ts";
import { storedTemplate } from "../apps/mobile/src/features/training/plans/domain/StoredPlanShape.ts";
import { weeksFromTemplate, workoutsFromTemplate, type TemplatePayload } from "../apps/mobile/src/features/training/plans/domain/TemplateModel.ts";

const context = { sourceSha256: "d".repeat(64), accountScope: "synthetic-scope", sourceWorkspaceId: "synthetic-workspace", targetWorkspaceId: "local-trainer" };
const timestamp = "2026-04-01T10:00:00Z", updated = "2026-04-02T10:00:00Z", archived = "2026-04-03T10:00:00Z";
const options = { clientIdentityRehearsal: { createdAt: "2026-04-05T10:00:00Z", profiles: true as const, questionnaires: true as const,
  workData: true as const, exercises: true as const, plans: true as const } };
const templateOptions = { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, templates: true as const } };
function allocate() { let n = 0; return () => `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}`; }
function seed(db: DatabaseSync) {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,
      birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT);
    CREATE TABLE exercise_catalog(id TEXT PRIMARY KEY,name TEXT,category TEXT,equipment TEXT,aliases_json TEXT,source TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_programs(id TEXT PRIMARY KEY,client_id TEXT,mode TEXT,name TEXT,cycle_type TEXT,settings_json TEXT,book_id TEXT,is_template INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_weeks(id TEXT PRIMARY KEY,program_id TEXT,week_index INTEGER,week_type TEXT,label TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_workouts(id TEXT PRIMARY KEY,client_id TEXT,program_id TEXT,week_id TEXT,sort_index INTEGER,name TEXT,data_json TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_exercises(id TEXT PRIMARY KEY,workout_id TEXT,sort_index INTEGER,name TEXT,note TEXT,template_exercise_id TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_set_logs(id TEXT PRIMARY KEY,exercise_id TEXT,set_index INTEGER,reps TEXT,weight TEXT,rpe TEXT,completed_at TEXT,data_json TEXT,deleted_at TEXT,set_kind TEXT);
    CREATE TABLE training_exercise_history(id TEXT PRIMARY KEY,client_id TEXT,exercise_key TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_library_programs(id TEXT,client_id TEXT,name TEXT,mode TEXT,created_at TEXT,archived_at TEXT,PRIMARY KEY(client_id,id));
    CREATE TABLE training_workspaces(client_id TEXT PRIMARY KEY,active_program_id TEXT,week_state_json TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_archive_entries(id TEXT PRIMARY KEY,client_id TEXT,data_json TEXT,archived_at TEXT);`);
  for (const id of ["a", "b", "c"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,?,NULL,'','','','',?)").run(id, context.sourceWorkspaceId,
    `Синтетический ${id}`, timestamp, updated, id === "b" ? archived : null, JSON.stringify({ trainerNotes: `Заметка ${id}`, trainerTags: ["Общий"] }));
  db.prepare("INSERT INTO exercise_catalog VALUES('catalog-x','Своё упражнение','Другое','','[]','user',?,?,NULL)").run(timestamp, updated);
  const definitions = [
    ["p-a1", "a", "periodized", "Первый цикл А", "book", 0, "shared-page", 2, 0, null],
    ["p-a2", "a", "periodized", "Второй цикл А", "book", 10, null, 1, 0, null],
    ["p-b1", "b", "periodized", "Копия первого цикла", "book", 0, "shared-page", 2, 0, null],
    ["p-c", "c", "free", "Простая программа", null, 0, null, 2, 0, null],
    ["p-old", "a", "periodized", "Удалённая страница", "book", 1, null, 1, 0, archived],
    ["p-template", "a", "periodized", "Старый шаблон", null, 0, null, 1, 1, null],
  ] as const;
  for (const [id, client, mode, name, book, pageIndex, sharedGroupId, weekCount, template, deleted] of definitions) {
    db.prepare("INSERT INTO training_programs VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, client, mode, name, mode === "free" ? "" : "hypertrophy",
      JSON.stringify({ pageIndex, totalWeeks: weekCount, repRange: "8-12", ...(sharedGroupId ? { sharedGroupId, participantIds: ["a", "b"] } : {}) }),
      book, template, timestamp, updated, deleted);
    for (let n = 0; n < weekCount; n++) {
      const week = `${id}:week:${n}`; db.prepare("INSERT INTO training_weeks VALUES(?,?,?,?,?,'{}',?)").run(week, id, n, n === 1 ? "heavy" : "", `Неделя ${n + 1}`, deleted);
      const workoutCount = id === "p-a1" && n === 0 ? 2 : 1;
      for (let w = 0; w < workoutCount; w++) {
        const workout = `${week}:workout:${w}`;
        db.prepare("INSERT INTO training_workouts VALUES(?,?,?,?,?,?,?, ?,?,?)").run(workout, client, id, week, w * 5,
          `${mode === "free" && n === 1 ? "Изменённая" : "Исходная"} тренировка ${w + 1}`, "{}", timestamp, updated, deleted);
        const exerciseCount = id === "p-a1" && n === 0 && w === 0 ? 2 : 1;
        for (let e = 0; e < exerciseCount; e++) {
          const exercise = `${workout}:exercise:${e}`, data = { catalogId: "catalog-x", repRange: "10", plannedWeight: "40", rir: "1–2", setCount: 1,
            ...(exerciseCount === 2 ? { supersetGroupId: "source-superset" } : {}) };
          db.prepare("INSERT INTO training_exercises VALUES(?,?,?,?,?,?,?,?)").run(exercise, workout, e * 3, "Снимок имени упражнения", "Плановое указание", "catalog-x", JSON.stringify(data), deleted);
          db.prepare("INSERT INTO training_set_logs VALUES(?,?,0,'20','10','8',?,?,?,'working')").run(`${exercise}:set`, exercise, updated,
            JSON.stringify({ plannedReps: mode === "free" && n === 1 ? "15" : "8-12", targetReps: "99", plannedWeight: "2,5" }), deleted);
        }
      }
    }
  }
  for (const [client, name, mode, id] of [["a", "Книга А", "periodized", "book"], ["b", "Книга Б", "periodized", "book"], ["c", "Простая программа", "free", "p-c"]]) {
    db.prepare("INSERT INTO training_library_programs VALUES(?,?,?,?,?,NULL)").run(id!, client!, name!, mode!, timestamp);
    db.prepare("INSERT INTO training_workspaces VALUES(?,?,'{}',?,NULL)").run(client!, client === "a" ? "p-a2" : client === "b" ? "p-b1" : "p-c", updated);
  }
  db.prepare("INSERT INTO training_archive_entries VALUES('archive-old','a',?,?)").run('{"programId":"p-old","workouts":[],"weeks":[]}', archived);
  const firstExercise = "p-a1:week:0:workout:0:exercise:0";
  db.prepare("INSERT INTO training_set_logs VALUES(?,?,0,'5','0','',NULL,?,NULL,'warmup')").run("warmup", firstExercise, '{"plannedReps":"5"}');
  db.prepare("UPDATE training_set_logs SET set_index=1 WHERE id=?").run(`${firstExercise}:set`);
  db.prepare("INSERT INTO training_set_logs VALUES(?,?,2,'4','12,5','9',?,?,NULL,'drop')").run("drop", firstExercise, updated, '{"plannedReps":"6"}');
  // A deleted duplicate occupies the old ordinal but never becomes a second active slot.
  db.prepare("INSERT INTO training_set_logs VALUES(?,?,1,'30','999','10',?,?,?,'working')").run("deleted-duplicate", firstExercise, updated, '{"plannedReps":"2"}', archived);
}
function read(db: DatabaseSync) {
  const catalog = readLegacyExerciseCatalogInSnapshot(db, context.accountScope);
  return { cards: readLegacyClientCardsInSnapshot(db, context.accountScope, readLegacyClientIdentityInSnapshot(db, context.accountScope)), catalog,
    refs: readLegacyExerciseReferencesInSnapshot(db, context.accountScope, catalog), plans: readLegacyPlansInSnapshot(db, context.accountScope) };
}
async function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void | Promise<void>) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source); await run(source, target); } finally { source.close(); target.close(); }
}
function stage(source: DatabaseSync, target: DatabaseSync, templates = false) {
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, templates ? templateOptions : options);
  return { input, ledger, result: ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate()) };
}
function mapped(db: DatabaseSync, table: string, id: string) {
  return db.prepare("SELECT * FROM r04_plan_source WHERE source_key=?").get(JSON.stringify([context.accountScope, table, id]))!;
}
const targetTables = ["clients", "questionnaire_versions", "questionnaire_answers", "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_receipt",
  "r04_exercise_ids", "r04_exercise_registry", "exercise_overlay", "r04_exercise_links", "r04_exercise_receipt", "r04_plan_ids", "r04_plan_source", "r04_plan_receipt",
  "training_programs", "training_program_members", "training_mesocycles", "training_weeks", "training_workouts", "training_planned_exercises", "training_planned_sets",
  "training_simple_overrides", "training_client_selection", "training_mesocycle_selection", "training_builder_drafts"];

function enableTemplateSource(db: DatabaseSync) {
  db.exec("ALTER TABLE training_programs ADD COLUMN template_workspace_id TEXT");
  db.prepare("UPDATE training_programs SET template_workspace_id=? WHERE is_template=1").run(context.sourceWorkspaceId);
}
function simpleTemplateSource(db: DatabaseSync) {
  enableTemplateSource(db);
  db.prepare("UPDATE training_programs SET is_template=1,template_workspace_id=? WHERE id='p-c'").run(context.sourceWorkspaceId);
  db.exec("UPDATE training_weeks SET week_type='' WHERE program_id='p-c'");
  db.prepare("UPDATE training_workouts SET name=? WHERE program_id='p-c'").run("Одинаковый план");
  db.prepare("UPDATE training_set_logs SET data_json=? WHERE exercise_id LIKE 'p-c:%'").run('{"plannedReps":"8-12","plannedWeight":"2,5"}');
}
function templatePayload(db: DatabaseSync, sourceId: string): TemplatePayload {
  const alias = mapped(db, "training_programs", sourceId), row = db.prepare("SELECT * FROM training_templates WHERE id=?").get(alias.target_id!);
  assert.ok(row); const value: unknown = JSON.parse(row.payload_json as string);
  assert.ok(storedTemplate(value)); assert.equal(value.kind, row.kind); return value;
}

test("book headers become programs and physical source programs become independent mesocycles with their own clients", () => fixture((source, target) => {
  const { result } = stage(source, target);
  assert.equal(result.status, "training-plans-rehearsal-staged"); assert.equal(result.finalizable, false);
  assert.equal(result.programRows, 3); assert.equal(result.mesocycleRows, 3); assert.equal(result.deferredArchiveRows, 1); assert.equal(result.deferredTemplatePages, 1);
  const a1 = mapped(target, "training_programs", "p-a1"), a2 = mapped(target, "training_programs", "p-a2"), b1 = mapped(target, "training_programs", "p-b1");
  assert.equal(a1.target_program_id, a2.target_program_id); assert.notEqual(a1.target_id, a2.target_id); assert.notEqual(a1.target_program_id, b1.target_program_id);
  assert.equal(target.prepare("SELECT title FROM training_programs WHERE id=?").get(a1.target_program_id!)?.title, "Книга А");
  assert.equal(target.prepare("SELECT title FROM training_programs WHERE id=?").get(b1.target_program_id!)?.title, "Книга Б");
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_plan_source WHERE disposition='PENDING_PLAN'").get()?.n, 0);
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));
test("actual production readers see page order, week settings, independent shared copies, and exact planned ranges", () => fixture(async (source, target) => {
  stage(source, target); const a1 = mapped(target, "training_programs", "p-a1"), b1 = mapped(target, "training_programs", "p-b1"), tx = nodeSqlitePort(target);
  const cycles = await readMesocycles(tx, context.targetWorkspaceId, String(a1.target_program_id), String(a1.target_client_id));
  assert.deepEqual(cycles.map((m) => m.title), ["Первый цикл А", "Второй цикл А"]);
  assert.deepEqual(cycles[0]!.weeks.map((w) => w.type), ["base", "heavy"]); assert.deepEqual(cycles[0]!.repRange, { min: 8, max: 12 });
  assert.equal(cycles[0]!.weeks[0]!.workouts.length, 2);
  assert.deepEqual(cycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.sets.map((s) => [s.reps, s.repsMax, s.loadGrams]), [[8, 12, 2500], [6, null, 40000]]);
  assert.deepEqual(cycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.rir, { min: 1, max: 2 });
  assert.equal(cycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.instruction, "Плановое указание");
  assert.equal(cycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.supersetId, cycles[0]!.weeks[0]!.workouts[0]!.exercises[1]!.supersetId);
  const group = await groupOfCopy(tx, context.targetWorkspaceId, String(a1.target_id));
  assert.equal(group.length, 2); assert.ok(group.some((g) => g.mesocycleId === b1.target_id));
  assert.notEqual(group[0]!.programId, group[1]!.programId);
}));
test("simple weekly variations preserve original physical exercise/set identities in real target overrides", () => fixture(async (source, target) => {
  const { ledger } = stage(source, target); const simple = mapped(target, "training_programs", "p-c"), tx = nodeSqlitePort(target);
  const base = await readStructure(tx, context.targetWorkspaceId, String(simple.target_program_id), 2);
  const weeks = await readSimpleWeeks(tx, context.targetWorkspaceId, String(simple.target_client_id), String(simple.target_program_id), base);
  assert.equal(weeks[0]!.workouts[0]!.title, "Исходная тренировка 1"); assert.equal(weeks[1]!.workouts[0]!.title, "Изменённая тренировка 1");
  assert.equal(weeks[0]!.workouts[0]!.id, weeks[1]!.workouts[0]!.id);
  assert.notEqual(weeks[0]!.workouts[0]!.exercises[0]!.id, weeks[1]!.workouts[0]!.exercises[0]!.id);
  assert.equal(weeks[1]!.workouts[0]!.exercises[0]!.sets[0]!.reps, 15);
  assert.equal(mapped(target, "training_weeks", "p-c:week:1").target_id, null);
  assert.equal(mapped(target, "training_weeks", "p-c:week:1").week_index, 2);
  const aliases = ledger.loadPlanDraftMappings();
  const first = aliases.get(JSON.stringify([context.accountScope, "training_workouts", "p-c:week:0:workout:0"]))!;
  const second = aliases.get(JSON.stringify([context.accountScope, "training_workouts", "p-c:week:1:workout:0"]))!;
  assert.equal(first.targetId, second.targetId); assert.equal(first.weekIndex, 1); assert.equal(second.weekIndex, 2);
}));
test("actual set weights/reps/completion and deleted/warmup/template sources never become fabricated planned or performed facts", () => fixture((source, target) => {
  stage(source, target); const firstSet = "p-a1:week:0:workout:0:exercise:0:set";
  const retained = JSON.parse(String(mapped(target, "training_set_logs", firstSet).source_json)) as Record<string, unknown>;
  assert.equal(retained.reps, "20"); assert.equal(retained.weight, "10"); assert.equal(retained.completed_at, updated);
  assert.equal(mapped(target, "training_set_logs", "warmup").disposition, "RETAINED_WARMUP_FACT_SOURCE");
  assert.equal(mapped(target, "training_set_logs", "deleted-duplicate").disposition, "RETAINED_DELETED_SOURCE");
  assert.equal(mapped(target, "training_programs", "p-old").target_id, null);
  assert.equal(mapped(target, "training_programs", "p-old").target_program_id, mapped(target, "training_programs", "p-a1").target_program_id);
  assert.equal(mapped(target, "training_set_logs", "warmup").target_program_id, mapped(target, "training_set_logs", firstSet).target_program_id);
  assert.equal(mapped(target, "training_set_logs", "warmup").week_index, 1);
  assert.equal(mapped(target, "training_programs", "p-template").disposition, "RETAINED_TEMPLATE_SOURCE");
  assert.equal(target.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='training_performed_sets'").get(), undefined);
  assert.equal(target.prepare("SELECT count(*) AS n FROM training_templates").get()?.n, 0);
}));
test("a similarly named metadata column cannot replace the real parent week of a retained fact source", () => fixture((source, target) => {
  source.exec("ALTER TABLE training_exercises ADD COLUMN week_index INTEGER DEFAULT 30");
  stage(source, target);
  assert.equal(mapped(target, "training_set_logs", "warmup").week_index, 1);
}));
test("only explicit legacy active-program selection maps to the matching root and mesocycle; archive never auto-selects", () => fixture((source, target) => {
  source.prepare("UPDATE training_library_programs SET archived_at=? WHERE client_id='b'").run(archived);
  stage(source, target); const a2 = mapped(target, "training_programs", "p-a2"), b1 = mapped(target, "training_programs", "p-b1");
  assert.equal(target.prepare("SELECT mesocycle_id FROM training_mesocycle_selection WHERE client_id=?").get(a2.target_client_id!)?.mesocycle_id, a2.target_id);
  assert.equal(target.prepare("SELECT 1 FROM training_client_selection WHERE client_id=?").get(b1.target_client_id!), undefined);
  assert.equal(target.prepare("SELECT archived_at FROM training_program_members WHERE client_id=?").get(b1.target_client_id!)?.archived_at, archived);
}));
test("plan aliases obey exact legacy precedence, missing values remain unknown, and excess precision is never rounded", () => {
  const precise = projectLegacyPlanPrescription({ plannedReps: "8-12", targetReps: "99", plannedWeight: "1,2500" }, { repRange: "20", plannedWeight: "40" });
  assert.equal(precise.reps, 8); assert.equal(precise.repsMax, 12); assert.equal(precise.loadGrams, 1250);
  assert.deepEqual(precise.basis, { reps: "set.plannedReps", load: "set.plannedWeight" });
  assert.equal(projectLegacyPlanPrescription({}, {}).reps, null); assert.equal(projectLegacyPlanPrescription({}, {}).loadGrams, null);
  assert.throws(() => projectLegacyPlanPrescription({ plannedWeight: "1,2501" }, {}), /PRESCRIPTION_INVALID/u);
});
test("every plan row boundary and receipt rolls back clients/Q/work/catalog/plan together and permits retry", async () => {
  for (const [phase, occurrence] of [["after-plan-ids", 1], ...Array.from({ length: 10 }, (_, n) => ["after-plan-rows", n + 1] as const),
    ["after-plan-source", 1], ["after-plan-receipt", 1], ["before-commit", 1]] as const) await fixture((source, target) => {
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options); let seen = 0;
    assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate(), (stage) => {
      if (stage === phase && ++seen === occurrence) throw new Error("injected");
    }), /WRITE_FAILED/u);
    for (const table of targetTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
    assert.equal(ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate()).programRows, 3);
  });
});
test("invalid plan values/ownership/active ordering/shared identity are blocked instead of being repaired or truncated", async () => {
  for (const sql of ["UPDATE training_programs SET name=' ' WHERE id='p-a2'", "UPDATE training_programs SET client_id='b' WHERE id='p-a2'",
    "UPDATE training_weeks SET week_index=4 WHERE id='p-a1:week:1'", "UPDATE training_workouts SET sort_index=0 WHERE id='p-a1:week:0:workout:1'",
    "UPDATE training_set_logs SET data_json='{broken' WHERE id='drop'", "UPDATE training_programs SET cycle_type='unknown' WHERE id='p-a2'",
    "UPDATE training_programs SET settings_json='{" + '"sharedGroupId":"shared-page","pageIndex":10,"totalWeeks":1' + "}' WHERE id='p-a2'"]) await fixture((source, target) => {
    source.exec(sql); const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate()), /PLANS_/u);
    for (const table of targetTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
  });
});
test("raw plan input is cloned before callbacks and cannot be replaced by later caller mutations", () => fixture((source, target) => {
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate(), (stage) => {
    if (stage === "after-ids") Object.assign(input.plans.tables.training_programs![0]!, { settings_json: "{broken" });
  });
  assert.equal(target.prepare("SELECT count(*) AS n FROM training_mesocycles").get()?.n, 3);
}));
test("a stale shared-group ID with conflicting participant lists cannot resurrect a removed participant", () => fixture((source, target) => {
  source.prepare("UPDATE training_programs SET settings_json=? WHERE id='p-a1'").run('{"pageIndex":0,"totalWeeks":2,"sharedGroupId":"shared-page","participantIds":["a"]}');
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate()), /SHARED_MEMBERSHIP_CONFLICT/u);
  for (const table of targetTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
}));
test("custom questionnaire history and plans remain independent owners inside the same committed database", () => fixture((source, target) => {
  source.exec(`CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));`);
  const schema = JSON.stringify({ version: 1, sections: [{ id: "custom-section", title: "Своя анкета", icon: "", hidden: false,
    questions: [{ id: "custom-question", type: "long_text", title: "Свой вопрос", required: false, access: "trainer_only", options: [], hidden: false }] }] });
  for (const revision of [1, 2]) source.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(`q-${revision}`, context.sourceWorkspaceId, revision,
    revision === 1 ? "published" : "draft", schema, timestamp, revision === 1 ? updated : null);
  source.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run(context.sourceWorkspaceId, "q-2", "q-1", updated);
  source.prepare("INSERT INTO client_questionnaire_answers VALUES('a','custom-question',?,1,?,NULL)").run('"Ответ отдельно от плана"', updated);
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientPlans(input.cards, readLegacyQuestionnaireInSnapshot(source, context.accountScope), input.catalog, input.refs, input.plans, allocate());
  assert.equal(target.prepare("SELECT schema_version FROM questionnaire_answers WHERE value_json=?").get('"Ответ отдельно от плана"')?.schema_version, 1);
  assert.equal(target.prepare("SELECT count(*) AS n FROM training_programs").get()?.n, 3);
  assert.ok(ledger.loadPlanDraftMappings().size > 0);
}));
test("committed target/source drift never updates a successful plan or silently heals a missing identity", async () => {
  for (const sql of ["UPDATE training_programs SET title='Edited'", "DELETE FROM training_planned_sets", "UPDATE training_simple_overrides SET workout_json=json_set(workout_json,'$.title','Edited')",
    "UPDATE r04_plan_source SET source_json='{}'", "DELETE FROM r04_plan_ids WHERE kind='SET'", "INSERT INTO training_builder_drafts VALUES('local-trainer','x','x',NULL,'{}','x')"]) await fixture((source, target) => {
    const { input, ledger } = stage(source, target); target.exec(sql);
    const edited = JSON.stringify(targetTables.map((t) => target.prepare(`SELECT * FROM ${t}`).all()));
    if (!sql.startsWith("INSERT INTO training_builder_drafts")) assert.throws(() => ledger.loadPlanDraftMappings(), /PARITY_MISMATCH/u);
    assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate()), /MISMATCH|COLLISION/u);
    assert.equal(JSON.stringify(targetTables.map((t) => target.prepare(`SELECT * FROM ${t}`).all())), edited);
  });
});
test("old exercise-only files keep their binding and plan-enabled files require the complete entry point", () => fixture((source, target) => {
  const input = read(source), earlier = { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, plans: undefined } };
  prepareCandidateIdentityLedger(target, context, earlier).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /FOREIGN_DATABASE/u);
  const empty = new DatabaseSync(":memory:");
  try { const ledger = prepareCandidateIdentityLedger(empty, context, options);
    assert.throws(() => ledger.stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate()), /PLANS_MODE_MISMATCH/u);
    assert.equal(empty.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
  } finally { empty.close(); }
}));
test("explicit declared set count creates only plan slots when working logs are absent; no performed values are guessed", () => fixture((source, target) => {
  const exercise = "p-a2:week:0:workout:0:exercise:0";
  source.prepare("DELETE FROM training_set_logs WHERE exercise_id=?").run(exercise);
  source.prepare("UPDATE training_exercises SET data_json=? WHERE id=?").run('{"catalogId":"catalog-x","setCount":3,"repRange":"12","plannedWeight":"0"}', exercise);
  stage(source, target); const mappedExercise = mapped(target, "training_exercises", exercise);
  const sets = target.prepare("SELECT reps,load_grams FROM training_planned_sets WHERE planned_exercise_id=?").all(mappedExercise.target_id!);
  assert.equal(sets.length, 3); assert.ok(sets.every((s) => s.reps === 12 && s.load_grams === 0));
}));
test("legacy set JSON can supply planned RIR when the exercise field is empty; actual RPE is never reused as RIR", () => fixture((source, target) => {
  const exercise = "p-a2:week:0:workout:0:exercise:0";
  source.prepare("UPDATE training_exercises SET data_json=? WHERE id=?").run('{"catalogId":"catalog-x","rir":""}', exercise);
  source.prepare("UPDATE training_set_logs SET data_json=? WHERE exercise_id=?").run('{"plannedReps":"10","rir":"3"}', exercise);
  stage(source, target); const mappedExercise = mapped(target, "training_exercises", exercise);
  assert.equal(target.prepare("SELECT rir_min FROM training_planned_exercises WHERE id=?").get(mappedExercise.target_id!)?.rir_min, 3);
}));
test("unassigned free workouts stay explicit source evidence without inventing a containing program", () => fixture((source, target) => {
  source.prepare("INSERT INTO training_workouts VALUES('standalone','a',NULL,NULL,0,'Свободная тренировка','{}',?,?,NULL)").run(timestamp, updated);
  source.prepare("INSERT INTO training_exercises VALUES('standalone-e','standalone',0,'Снимок','','catalog-x',?,NULL)").run('{"catalogId":"catalog-x"}');
  const { result } = stage(source, target);
  assert.equal(result.programRows, 3);
  assert.equal(mapped(target, "training_workouts", "standalone").disposition, "RETAINED_FREE_WORKOUT_SOURCE");
  assert.equal(mapped(target, "training_exercises", "standalone-e").target_id, null);
}));
test("a read-only source file and reopened/reordered staged plan retain exact bytes and all committed IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-plans-")), sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); source.close(); source = null; const sourceHash = hash(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN"); const input = read(source), exact = { ...context, sourceSha256: sourceHash };
    target = new DatabaseSync(targetPath); prepareCandidateIdentityLedger(target, exact, options).stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate());
    target.close(); target = null; const targetHash = hash(targetPath); target = new DatabaseSync(targetPath);
    for (const rows of Object.values(input.plans.tables)) if (rows !== null) (rows as unknown[]).reverse();
    const result = prepareCandidateIdentityLedger(target, exact, options).stageClientPlans([...input.cards].reverse(), null, [...input.catalog].reverse(), [...input.refs].reverse(), input.plans,
      () => { throw new Error("must reuse IDs"); });
    assert.equal(result.insertedRows, 0); target.close(); target = null; assert.equal(hash(targetPath), targetHash);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), sourceHash);
  } finally { target?.close(); source?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("legacy periodized templates become account-owned MESOCYCLE templates with only prescription and exact source provenance", () => fixture((source, target) => {
  enableTemplateSource(source);
  const setId = "p-template:week:0:workout:0:exercise:0:set";
  source.prepare("UPDATE training_set_logs SET data_json=? WHERE id=?").run(JSON.stringify({ plannedReps: "8-12", plannedWeight: "2,5",
    historyOriginId: "must-stay-source-only", historyDateStatus: "unknown", segments: [{ reps: "3", weight: "99" }] }), setId);
  const { result, ledger } = stage(source, target, true), payload = templatePayload(target, "p-template");
  assert.equal(result.templateRows, 1); assert.equal(result.deferredTemplatePages, 0); assert.equal(result.programRows, 3);
  assert.equal(payload.kind, "MESOCYCLE"); if (payload.kind !== "MESOCYCLE") assert.fail();
  assert.equal(payload.mesocycle.title, "Старый шаблон"); assert.equal(payload.mesocycle.weeks[0]!.type, "base");
  const exercise = payload.mesocycle.weeks[0]!.workouts[0]!.exercises[0]!;
  assert.deepEqual(exercise.sets.map((s) => [s.reps, s.repsMax, s.loadGrams]), [[8, 12, 2500]]);
  assert.equal(exercise.instruction, "Плановое указание"); assert.deepEqual(exercise.rir, { min: 1, max: 2 });
  const serialized = JSON.stringify(payload);
  for (const key of ["completedAt", "historyOriginId", "segments", "lineageId", "participantIds", "createdAt", "startDate", "clientId", "rpe"]) assert.equal(serialized.includes(`"${key}"`), false, key);
  const raw = JSON.parse(mapped(target, "training_set_logs", setId).source_json as string) as Record<string, unknown>;
  assert.equal(raw.reps, "20"); assert.equal(raw.weight, "10"); assert.equal(raw.completed_at, updated);
  assert.equal((JSON.parse(raw.data_json as string) as Record<string, unknown>).historyOriginId, "must-stay-source-only");
  const alias = ledger.loadPlanDraftMappings().get(JSON.stringify([context.accountScope, "training_programs", "p-template"]))!;
  assert.equal(alias.disposition, "TEMPLATE_PLAN"); assert.equal(alias.programId, null);
  assert.deepEqual({ ...target.prepare("SELECT created_at,updated_at,revision FROM training_templates").get() }, { created_at: timestamp, updated_at: updated, revision: 1 });
  let next = 0; const copied = weeksFromTemplate(payload.mesocycle, () => `copy-${++next}`);
  assert.notEqual(copied[0]!.workouts[0]!.id, payload.mesocycle.weeks[0]!.workouts[0]!.id);
  assert.notEqual(copied[0]!.workouts[0]!.exercises[0]!.id, exercise.id);
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("equivalent physical weeks form one SIMPLE template with stable logical aliases and independent application", () => fixture((source, target) => {
  simpleTemplateSource(source);
  // Client execution contamination must not make otherwise equivalent template
  // weeks different, or supply a prescription that the source never contained.
  source.prepare("UPDATE training_set_logs SET reps='1',weight='999',completed_at=NULL WHERE exercise_id LIKE 'p-c:week:1:%'").run();
  const { result } = stage(source, target, true), payload = templatePayload(target, "p-c");
  assert.equal(result.templateRows, 2); assert.equal(result.programRows, 2); assert.equal(payload.kind, "SIMPLE");
  if (payload.kind !== "SIMPLE") assert.fail(); assert.equal(payload.weeks, 2); assert.equal(payload.workouts.length, 1);
  for (const [table, suffix] of [["training_workouts", ":workout:0"], ["training_exercises", ":workout:0:exercise:0"], ["training_set_logs", ":workout:0:exercise:0:set"]]) {
    const a = mapped(target, table!, `p-c:week:0${suffix}`), b = mapped(target, table!, `p-c:week:1${suffix}`);
    assert.equal(a.target_id, b.target_id); assert.equal(a.week_index, 1); assert.equal(b.week_index, 2); assert.equal(a.target_program_id, null);
  }
  let next = 0; const copied = workoutsFromTemplate(payload.workouts, () => `new-${++next}`);
  assert.notEqual(copied[0]!.id, payload.workouts[0]!.id); assert.equal(copied[0]!.exercises[0]!.sets[0]!.loadGrams, 2500);
}));

test("a legacy saved page with multiple typed weeks stays a MESOCYCLE and cannot import its old group membership", () => fixture((source, target) => {
  enableTemplateSource(source);
  source.prepare("UPDATE training_programs SET is_template=1,book_id=NULL,template_workspace_id=? WHERE id='p-a1'").run(context.sourceWorkspaceId);
  stage(source, target, true); const payload = templatePayload(target, "p-a1");
  assert.equal(payload.kind, "MESOCYCLE"); if (payload.kind !== "MESOCYCLE") assert.fail();
  assert.deepEqual(payload.mesocycle.weeks.map((w) => w.type), ["base", "heavy"]);
  const exercises = payload.mesocycle.weeks[0]!.workouts[0]!.exercises;
  assert.ok(exercises[0]!.supersetId); assert.equal(exercises[0]!.supersetId, exercises[1]!.supersetId);
  assert.equal(exercises[0]!.sets.length, 2); assert.equal(JSON.stringify(payload).includes("shared-page"), false);
  assert.equal(mapped(target, "training_set_logs", "warmup").disposition, "RETAINED_TEMPLATE_WARMUP_SOURCE");
  assert.equal(mapped(target, "training_programs", "p-a1").target_program_id, null);
}));

test("template owner, representability, and ordering failures roll back every staged owner", async () => {
  for (const sql of ["UPDATE training_programs SET template_workspace_id=NULL WHERE id='p-template'",
    "UPDATE training_programs SET template_workspace_id='foreign' WHERE id='p-template'",
    "UPDATE training_programs SET book_id='unexpected-book' WHERE id='p-template'",
    "UPDATE training_weeks SET week_index=2 WHERE program_id='p-template'",
    "UPDATE training_set_logs SET data_json='{bad' WHERE exercise_id LIKE 'p-template:%'",
    "UPDATE training_programs SET name=' ' WHERE id='p-template'"]) await fixture((source, target) => {
      enableTemplateSource(source); source.exec(sql); const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, templateOptions);
      assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate()), /PLANS_/u);
      for (const table of [...targetTables, "training_templates"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    });
});

test("simple template week differences are not silently discarded or converted to another program kind", () => fixture((source, target) => {
  simpleTemplateSource(source);
  source.prepare("UPDATE training_set_logs SET data_json=? WHERE exercise_id LIKE 'p-c:week:1:%'").run('{"plannedReps":"15"}');
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, templateOptions);
  assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate()), /SIMPLE_TEMPLATE_WEEKS_UNREPRESENTABLE/u);
  assert.equal(target.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
  assert.equal(target.prepare("SELECT count(*) AS n FROM training_templates").get()?.n, 0);
}));

test("two same-named live templates retain separate identities", () => fixture((source, target) => {
  simpleTemplateSource(source);
  source.prepare("UPDATE training_programs SET name='Старый шаблон' WHERE id='p-c'").run();
  stage(source, target, true);
  const templates = target.prepare("SELECT id,title FROM training_templates").all();
  assert.equal(templates.length, 2); assert.equal(templates[0]!.title, templates[1]!.title); assert.notEqual(templates[0]!.id, templates[1]!.id);
}));

test("deleted template descendants never return to the shared library", () => fixture((source, target) => {
  enableTemplateSource(source); source.prepare("UPDATE training_programs SET deleted_at=? WHERE id='p-template'").run(archived);
  const { result } = stage(source, target, true);
  assert.equal(result.templateRows, 0); assert.equal(result.deferredTemplatePages, 1);
  assert.equal(mapped(target, "training_programs", "p-template").disposition, "RETAINED_TEMPLATE_SOURCE");
  assert.equal(mapped(target, "training_exercises", "p-template:week:0:workout:0:exercise:0").target_id, null);
}));

test("template-enabled staging binds the complete mode; older plan jobs and missing source ownership cannot be claimed", () => fixture((source, target) => {
  enableTemplateSource(source); stage(source, target);
  assert.throws(() => prepareCandidateIdentityLedger(target, context, templateOptions), /CONTEXT_MISMATCH/u);
  const empty = new DatabaseSync(":memory:");
  try {
    assert.throws(() => prepareCandidateIdentityLedger(empty, context, { clientIdentityRehearsal: { ...templateOptions.clientIdentityRehearsal, plans: undefined } }), /CONTEXT_INVALID/u);
    source.exec("ALTER TABLE training_programs DROP COLUMN template_workspace_id");
    assert.throws(() => stage(source, empty, true), /TEMPLATE_OWNER_MISMATCH/u);
    assert.equal(empty.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
  } finally { empty.close(); }
}));

test("all 15 template-plan transaction boundaries roll back clients, questionnaires, work data, registry and templates together", async () => {
  for (const [phase, occurrence] of [["after-plan-ids", 1], ...Array.from({ length: 11 }, (_, n) => ["after-plan-rows", n + 1] as const),
    ["after-plan-source", 1], ["after-plan-receipt", 1], ["before-commit", 1]] as const) await fixture((source, target) => {
    enableTemplateSource(source); const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, templateOptions); let seen = 0;
    assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate(), (stage) => {
      if (stage === phase && ++seen === occurrence) throw new Error("injected");
    }), /WRITE_FAILED/u);
    for (const table of [...targetTables, "training_templates"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    assert.equal(ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate()).templateRows, 1);
  });
});

test("template aliases verify payload and ID parity, and source changes cannot rewrite an already staged template", () => fixture((source, target) => {
  enableTemplateSource(source); const { input, ledger } = stage(source, target, true);
  const original = target.prepare("SELECT payload_json FROM training_templates").get()!.payload_json;
  target.prepare("UPDATE training_templates SET payload_json=?").run('{"kind":"MESOCYCLE","mesocycle":{"title":"drift","weeks":[]}}');
  assert.throws(() => ledger.loadPlanDraftMappings(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE training_templates SET payload_json=?").run(original!); assert.ok(ledger.loadPlanDraftMappings().size > 0);
  source.exec("UPDATE training_programs SET name='Изменённый шаблон' WHERE id='p-template'"); const changed = read(source);
  assert.throws(() => ledger.stageClientPlans(changed.cards, null, changed.catalog, changed.refs, changed.plans, allocate()), /PARITY_MISMATCH/u);
  assert.equal(target.prepare("SELECT title FROM training_templates").get()?.title, "Старый шаблон");
  assert.equal(ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, () => { throw new Error("reuse IDs"); }).templateRows, 1);
}));

test("template receipts and aliases survive file reopen and reordered retry without modifying source or target bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-templates-")), sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); simpleTemplateSource(source); source.close(); source = null; const sourceHash = hash(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN");
    const input = read(source), exact = { ...context, sourceSha256: sourceHash };
    target = new DatabaseSync(targetPath); const first = prepareCandidateIdentityLedger(target, exact, templateOptions);
    first.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocate());
    const aliases = [...first.loadPlanDraftMappings()]; target.close(); target = null; const targetHash = hash(targetPath);
    target = new DatabaseSync(targetPath); for (const rows of Object.values(input.plans.tables)) if (rows !== null) (rows as unknown[]).reverse();
    const reopened = prepareCandidateIdentityLedger(target, exact, templateOptions);
    const result = reopened.stageClientPlans([...input.cards].reverse(), null, [...input.catalog].reverse(), [...input.refs].reverse(), input.plans,
      () => { throw new Error("must reuse IDs"); });
    assert.equal(result.templateRows, 2); assert.deepEqual([...reopened.loadPlanDraftMappings()], aliases);
    target.close(); target = null; assert.equal(hash(targetPath), targetHash);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), sourceHash);
  } finally { target?.close(); source?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("plan-only alias reads reject an unclaimed template inserted outside the bound rehearsal", () => fixture((source, target) => {
  const { ledger } = stage(source, target);
  target.prepare("INSERT INTO training_templates VALUES('unclaimed',?,'SIMPLE','Посторонний шаблон',?,1,?,?)")
    .run(context.targetWorkspaceId, '{"kind":"SIMPLE","weeks":1,"workouts":[]}', timestamp, updated);
  assert.throws(() => ledger.loadPlanDraftMappings(), /PARITY_MISMATCH/u);
}));
