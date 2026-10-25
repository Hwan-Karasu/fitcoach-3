import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacyClientWorkDataStagingExtension } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientWorkDataStaging.ts";
import { legacyQuestionnaireStagingExtension } from "../apps/mobile/src/features/questionnaire/data/legacy-import/LegacyQuestionnaireStaging.ts";
import { legacyExerciseCatalogStagingExtension } from "../apps/mobile/src/features/exercises/data/legacy-import/LegacyExerciseCatalogStaging.ts";
import { legacyPlansStagingExtension } from "../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStaging.ts";
import { legacyLoadPlanMappingsPlan, plansRehearsalObjects } from "../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStagePlan.ts";
import { combineLegacyStageExtensions } from "../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import { runLegacyWritePlan, type LegacyPlanCheckpoint } from "../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { openIsolatedSqliteConnection } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import type { LegacyImportSourceSnapshots } from "../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
import { readAdmittedLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { loadStagedPlanMappings } from "./r04/LegacyPlansStage.ts";
import { readSimpleWeeks } from "../apps/mobile/src/features/training/plans/data/SimpleWeekStore.ts";
import { readStructure } from "../apps/mobile/src/features/training/plans/data/SimplePlanStore.ts";
import { readMesocycles } from "../apps/mobile/src/features/training/plans/data/PeriodizedStore.ts";
import { storedTemplate } from "../apps/mobile/src/features/training/plans/domain/StoredPlanShape.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";

const scope = "portable-plans-writer", sourceTime = "2026-10-02T12:00:00Z", importedAt = "2026-10-24T12:00:00Z";
const allocator = () => { let next = 0; return () => `11111111-1111-4111-8111-${String(++next).padStart(12, "0")}`; };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const earlier = ["r04_candidate_identity", "r04_candidate_ids", "workspaces", "clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt",
  "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_reviews", "r04_work_receipt", "r04_exercise_ids", "r04_exercise_registry", "exercise_overlay", "r04_exercise_links", "r04_exercise_receipt"];
const tables = [...earlier, ...Object.entries(plansRehearsalObjects).filter(([, kind]) => kind === "table").map(([name]) => name)];
const phases: readonly LegacyPlanCheckpoint[] = ["after-archive-plans", "after-plan-ids", "after-plan-rows", "after-plan-source", "after-plan-receipt"];
function owners(s: LegacyImportSourceSnapshots) { return combineLegacyStageExtensions(legacyQuestionnaireStagingExtension(s.questionnaire), legacyClientWorkDataStagingExtension(),
  legacyExerciseCatalogStagingExtension(s.exerciseCatalog, { accountScope: scope, clients: s.clients.rows, workouts: s.plans.tables.training_workouts, exercises: s.plans.tables.training_exercises, history: s.executions.tables.training_exercise_history })); }
const extension = (s: LegacyImportSourceSnapshots, flags = { templates: true, archives: true }) => combineLegacyStageExtensions(owners(s), legacyPlansStagingExtension(s.plans, flags));
function inspect<Result>(path: string, run: (db: DatabaseSync) => Result): Result { const db = new DatabaseSync(path); try { return run(db); } finally { db.close(); } }
const records = (path: string) => inspect(path, (db) => tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
function empty(path: string) { inspect(path, (db) => {
  for (const table of tables.filter((name) => !["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name))) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
}); }
function archivePage(programId: string, mode: "free" | "periodized") {
  return { programId, mode, cycleType: mode === "free" ? "" : "hypertrophy", settings: { totalWeeks: 1, participantIds: ["a", "b"], sharedGroupId: "old-shared" },
    totalWeeks: 1, totalWorkouts: 1, completedWorkouts: 1, weeks: [{ weekId: `${programId}:week`, weekIndex: 0, label: "Old week", weekType: "", workoutCount: 1, data: {} }],
    workouts: [{ name: "Archived workout", status: "completed", weekIndex: 0, sortIndex: 0, data: {}, exercises: [{ name: "Old exercise", note: "Original instruction", sortIndex: 0,
      templateExerciseId: "x", data: { catalogId: "x", rir: "1-2" }, sets: [{ setIndex: 0, reps: "20", weight: "15", rpe: "8", completedAt: sourceTime,
        setKind: "working", data: { plannedReps: "8-12", plannedWeight: "2,5" } }] }] }] };
}
function seed(db: DatabaseSync) {
  seedLegacyBackupMetadata(db, scope);
  db.exec(`UPDATE clients SET name='Same name',profile_json='{"trainerNotes":"Original note","trainerTags":["Shared tag"]}';
    INSERT INTO clients SELECT 'b',workspace_id,name,created_at,updated_at,'2026-10-03T12:00:00Z',deleted_at,birthdate,height,gender,avatar_emoji,profile_json FROM clients WHERE id='a';
    ALTER TABLE training_archive_entries ADD COLUMN title TEXT;
    CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));`);
  const schema = JSON.stringify({ version: 1, sections: [{ id: "custom", title: "Original section", icon: "", hidden: false,
    questions: [{ id: "custom-question", title: "Original question", type: "short_text", required: false, access: "trainer_only", options: [], hidden: false }] }] });
  for (const [id, version, status] of [["published", 1, "published"], ["draft", 2, "draft"]] as const) db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(id, "synthetic-workspace", version, status, schema, sourceTime, status === "published" ? sourceTime : null);
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run("synthetic-workspace", "draft", "published", sourceTime);
  db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run("a", "custom-question", '"Original answer"', 1, sourceTime, null);
  db.prepare("INSERT INTO exercise_catalog VALUES('x','Original exercise','Другое','','[]','user',?,?,NULL)").run(sourceTime, sourceTime);
  for (const [id, client, mode, count, template] of [["simple", "a", "free", 2, 0], ["periodized", "b", "periodized", 1, 0], ["template", "a", "free", 1, 1]] as const) {
    db.prepare("INSERT INTO training_programs(id,client_id,mode,name,cycle_type,settings_json,book_id,is_template,created_at,updated_at,deleted_at,template_workspace_id) VALUES(?,?,?,?,?,?,NULL,?,?,?,NULL,?)").run(id, client, mode, "Same plan", mode === "free" ? "" : "hypertrophy", JSON.stringify({ totalWeeks: count }), template, sourceTime, sourceTime, template ? "synthetic-workspace" : null);
    for (let week = 0; week < count; week++) {
      const key = `${id}-${week}`;
      db.prepare("INSERT INTO training_weeks(id,program_id,week_index,week_type,data_json,deleted_at) VALUES(?,?,?,'','{}',NULL)").run(`week-${key}`, id, week);
      db.prepare("INSERT INTO training_workouts(id,client_id,program_id,week_id,sort_index,name,data_json,created_at,updated_at,deleted_at) VALUES(?,?,?,?,0,'Original workout','{}',?,?,NULL)").run(`workout-${key}`, client, id, `week-${key}`, sourceTime, sourceTime);
      db.prepare("INSERT INTO training_exercises(id,workout_id,sort_index,name,note,template_exercise_id,data_json,deleted_at) VALUES(?,?,0,'Old instance','Original instruction','x',?,NULL)").run(`exercise-${key}`, `workout-${key}`, '{"catalogId":"x","rir":"1-2","restSeconds":120}');
      db.prepare("INSERT INTO training_set_logs(id,exercise_id,set_index,reps,weight,rpe,completed_at,data_json,deleted_at,set_kind) VALUES(?,?,0,'20','15','8',?,?,NULL,'working')").run(`set-${key}`, `exercise-${key}`, sourceTime, JSON.stringify({ plannedReps: week ? "15" : "8-12", plannedWeight: "2,5" }));
    }
  }
  db.prepare("INSERT INTO training_workspaces(client_id,active_program_id,week_state_json,updated_at,deleted_at) VALUES('a','simple','{}',?,NULL)").run(sourceTime);
  const page = archivePage("periodized", "periodized"), book = { ...page, cycles: [{ name: "Old cycle", snapshot: page }] };
  for (const [id, data] of [["archive-book", book], ["archive-simple", archivePage("old-simple", "free")]] as const) db.prepare("INSERT INTO training_archive_entries(id,client_id,data_json,archived_at,deleted_at,title) VALUES(?,'a',?,?,NULL,'Original archive')").run(id, JSON.stringify(data), sourceTime);
  db.prepare("INSERT INTO training_archive_entries(id,client_id,data_json,archived_at,deleted_at,title) VALUES('deleted-archive','a','{broken',?,?,'Deleted archive')").run(sourceTime, sourceTime);
  updateLegacyManifestSize(db);
}
async function setup(dir: string) {
  const sourcePath = join(dir, "source.sqlite"), db = new DatabaseSync(sourcePath); seed(db); db.close(); const sha = digest(sourcePath), input = nativeFactory(sourcePath);
  const { admission, snapshots } = await readAdmittedLegacyDomainSnapshots(input.open, statSync(sourcePath).size);
  assert.equal(input.handles.size, 0); assert.equal(digest(sourcePath), sha);
  const stagePath = join(dir, "stage.sqlite");
  return { dir, sourcePath, sha, snapshots, stagePath, native: nativeFactory(stagePath), context: { sourceSha256: sha, accountScope: admission.accountScope, sourceWorkspaceId: admission.sourceWorkspaceId!, targetWorkspaceId: "local-trainer" } };
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-plans-stage-"));
  try { await run(await setup(dir)); }
  finally { const absolute = resolve(dir); assert.equal(dirname(absolute), resolve(tmpdir())); assert.ok(basename(absolute).startsWith("athlete-r04-plans-stage-")); rmSync(absolute, { recursive: true, force: true }); }
}

test("admitted simple/periodized/templates/archives reach async staging with host-identical rows, IDs, receipts and actual domain readers", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator());
  assert.equal(result.extensionResult![1].targetFactsCreated, 0); assert.equal(result.extensionResult![1].templateRows, 1); assert.equal(result.extensionResult![1].archivedProgramRows, 2);
  const hostPath = join(f.dir, "host.sqlite"); inspect(f.sourcePath, (source) => inspect(hostPath, (target) => {
    const catalog = readLegacyExerciseCatalogInSnapshot(source, scope), refs = readLegacyExerciseReferencesInSnapshot(source, scope, catalog);
    const ledger = prepareCandidateIdentityLedger(target, f.context, { clientIdentityRehearsal: { createdAt: importedAt, profiles: true, questionnaires: true, workData: true, exercises: true, plans: true, templates: true, archives: true } });
    ledger.stageClientPlans(projectLegacyClientCards(f.snapshots.clients, projectLegacyClientIdentities(f.snapshots.clients)), projectLegacyQuestionnaire(f.snapshots.questionnaire!), catalog, refs, f.snapshots.plans, allocator());
  }));
  assert.deepEqual(records(f.stagePath), records(hostPath));
  const db = await openIsolatedSqliteConnection(f.native.open);
  try {
    const mappings = await runLegacyWritePlan(db, legacyLoadPlanMappingsPlan(true)); assert.deepEqual(mappings, inspect(hostPath, (host) => loadStagedPlanMappings(host, true)));
    const simple = mappings.get(JSON.stringify([scope, "training_programs", "simple"]))!;
    const base = await readStructure(db, f.context.targetWorkspaceId, simple.programId!, 2);
    const weeks = await readSimpleWeeks(db, f.context.targetWorkspaceId, simple.clientId!, simple.programId!, base); assert.equal(weeks.length, 2);
    assert.deepEqual(weeks.map((week) => week.workouts[0]!.exercises[0]!.sets.map((set) => [set.reps, set.repsMax, set.loadGrams])), [[[8, 12, 2500]], [[15, null, 2500]]]);
    const periodized = mappings.get(JSON.stringify([scope, "training_programs", "periodized"]))!;
    assert.equal((await readMesocycles(db, f.context.targetWorkspaceId, periodized.programId!, periodized.clientId!)).length, 1);
  } finally { await db.close(); }
  inspect(f.stagePath, (db) => {
    const template = JSON.parse(db.prepare("SELECT payload_json FROM training_templates").get()!.payload_json as string) as unknown; assert.equal(storedTemplate(template), true);
    assert.equal(JSON.stringify(template).includes("completedAt"), false); assert.equal(db.prepare("SELECT count(*) AS n FROM training_planned_sets WHERE reps=20").get()!.n, 0);
    const exerciseIds = new Set(db.prepare("SELECT target_id FROM r04_plan_ids WHERE kind='EXERCISE'").all().map((row) => row.target_id));
    for (const row of db.prepare("SELECT source_key FROM r04_plan_ids WHERE kind='SET'").all()) { const key = JSON.parse(row.source_key as string) as unknown[]; if (key[1] === "template-set-slot") assert.ok(exerciseIds.has(key[2] as string)); }
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("SELECT target_client_id FROM r04_plan_source WHERE source_table='training_archive_entries' AND source_row_id='archive-book' AND disposition='ARCHIVE_PROGRAM'").get()!.target_client_id, result.ids.clients.get(JSON.stringify([scope, "a"])));
  });
  assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("every async plan/archive boundary rolls back all owners then retry/reopen/reordered replay preserve IDs", async () => {
  for (const phase of [...phases, "before-commit"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator(), async (at) => { if (at === phase) { await Promise.resolve(); throw new Error("PRIVATE interrupted plan"); } }), /WRITE_FAILED/u); empty(f.stagePath);
    await stage.stageClients(f.snapshots.clients, allocator()); const before = records(f.stagePath);
    const source = structuredClone(f.snapshots); for (const rows of Object.values(source.plans.tables)) if (rows) (rows as unknown[]).reverse();
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(source)); await reopened.stageClients(source.clients, () => assert.fail("replay allocated"));
    assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0);
  });
});

test("plan COMMIT acknowledgement loss does not duplicate programs, templates, archive aliases or IDs", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); let failed = false;
  f.native.state.after = (call) => { if (!failed && call.kind === "exec" && call.sql === "COMMIT") { failed = true; throw new Error("PRIVATE commit acknowledgement lost"); } };
  await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); const before = records(f.stagePath); f.native.state.after = undefined;
  const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await reopened.stageClients(f.snapshots.clients, () => assert.fail("committed ID allocated"));
  assert.deepEqual(records(f.stagePath), before);
}));

test("plan raw/options capture prevents caller mutation from replacing the pending structure", () => fixture(async (f) => {
  const source = structuredClone(f.snapshots), flags = { templates: true, archives: true }, owner = extension(source, flags);
  Object.assign(source.plans.tables.training_programs![0]!, { name: "Changed plan" }); flags.archives = false;
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owner); const result = await stage.stageClients(f.snapshots.clients, allocator());
  assert.equal(result.extensionResult![1].archivedProgramRows, 2); inspect(f.stagePath, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM training_programs WHERE title='Changed plan'").get()!.n, 0));
}));

test("invalid template ownership, archive mirrors and prescription cannot commit earlier owners or pending IDs", async () => {
  for (const kind of ["template", "archive", "prescription", "collision"] as const) await fixture(async (f) => {
    const source = structuredClone(f.snapshots);
    if (kind === "template") Object.assign(source.plans.tables.training_programs!.find((row) => row.id === "template")!, { template_workspace_id: "foreign" });
    if (kind === "archive") { const row = source.plans.tables.training_archive_entries!.find((r) => r.id === "archive-book")!; const value = JSON.parse(row.data_json as string) as { completedWorkouts: number }; value.completedWorkouts = 99; Object.assign(row, { data_json: JSON.stringify(value) }); }
    if (kind === "prescription") Object.assign(source.plans.tables.training_set_logs![0]!, { data_json: '{"plannedWeight":"2.5001"}' });
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(source)); let plans = false, collided = false; const next = allocator();
    await assert.rejects(stage.stageClients(source.clients, () => {
      if (plans && !collided) { collided = true; return "11111111-1111-4111-8111-000000000001"; }
      return next();
    }, (phase) => { if (kind === "collision" && phase === "after-exercise-receipt") plans = true; }), /R04_ID_LEDGER_(?:PLANS|ARCHIVE_PLANS)_/u); empty(f.stagePath);
  });
});

test("changing bound plan/template/archive mode is rejected before writes", () => fixture(async (f) => {
  assert.throws(() => legacyPlansStagingExtension(f.snapshots.plans, { templates: false, archives: true }), /CONTEXT_INVALID/u);
  await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots, { templates: true, archives: false })); const before = digest(f.stagePath);
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /CONTEXT_MISMATCH/u); assert.equal(digest(f.stagePath), before);
}));

test("target plan/source/receipt drift is detected without overwriting retained rows or creating new IDs", async () => {
  for (const sql of ["UPDATE training_programs SET title='Drift'", "UPDATE r04_plan_source SET disposition='Drift'", "UPDATE r04_plan_receipt SET target_json='{}'"]) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator()); inspect(f.stagePath, (db) => db.exec(sql)); const before = records(f.stagePath);
    await assert.rejects(stage.stageClients(f.snapshots.clients, () => assert.fail("drift allocated")), /PLANS_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), before);
  });
});

test("plan schema and native row insertion failures rollback initial schema or all preceding owners", async () => {
  for (const kind of ["schema", "write"] as const) await fixture(async (f) => {
    if (kind === "write") await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    let failed = false; f.native.state.fail = (call) => { if (!failed && call.kind === "run" && (kind === "schema" ? call.sql.startsWith("CREATE TABLE r04_plan_ids(") : call.sql.startsWith("INSERT INTO training_planned_sets("))) { failed = true; return true; } return false; };
    if (kind === "schema") { await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /WRITE_FAILED/u); inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_'").all(), [])); }
    else { const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); empty(f.stagePath); }
    assert.equal(failed, true); assert.equal(f.native.handles.size, 0); f.native.state.fail = undefined;
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator());
  });
});
