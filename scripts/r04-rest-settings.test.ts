import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { projectLegacyRest } from "../apps/mobile/src/features/training/plans/domain/legacy-import/LegacyPlanPrescription.ts";
import { TEMPLATE_TARGET_TABLES } from "../apps/mobile/src/features/training/plans/domain/legacy-import/LegacyPlansProjection.ts";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { fixture as nutritionFixture, referenceDay } from "./support/legacy-nutrition-staging.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";
import { runLegacyJobWorker } from "./support/legacy-job-worker.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { createSqliteBackup, prepareBackupForRestore } from "./r06/SqliteBackup.ts";

const at = "2026-03-01T12:00:00.000Z";
const exercise = (key: string) => ({ key, catalogId: "x", name: "Exercise", setCount: 1, repRange: "8-12", rir: "1-2", plannedWeight: "2,5" });
function seed(db: DatabaseSync) {
  db.exec("UPDATE training_exercises SET data_json=json_set(data_json,'$.restSeconds',0,'$.restSec',180) WHERE id='e-a0'; UPDATE training_exercises SET data_json=json_set(data_json,'$.restSec',0) WHERE id='e-a1'; UPDATE training_exercises SET data_json=json_set(data_json,'$.restSeconds',1859) WHERE id='e-b0'");
  const row = db.prepare("SELECT data_json FROM training_archive_entries WHERE id='archive'").get()!;
  const archive = JSON.parse(row.data_json as string) as { cycles: { snapshot: { workouts: { exercises: { data: Record<string, unknown> }[] }[] } }[]; workouts: { exercises: { data: Record<string, unknown> }[] }[] };
  for (const [i, seconds] of [0, 60].entries()) { archive.cycles[i]!.snapshot.workouts[0]!.exercises[0]!.data.restSeconds = seconds; archive.workouts[i]!.exercises[0]!.data.restSeconds = seconds; }
  db.prepare("UPDATE training_archive_entries SET data_json=? WHERE id='archive'").run(JSON.stringify(archive));
  db.exec("ALTER TABLE training_library_programs ADD COLUMN revision INTEGER; INSERT INTO training_library_programs SELECT id,client_id,name,mode,created_at,NULL,7 FROM training_programs");
  const put = (client: string, kind: string, programId: string | null, draft: unknown) => db.prepare("INSERT INTO app_settings VALUES(?,?,?)").run(
    `training_builder_draft_v2:${encodeURIComponent(client)}:${JSON.stringify([kind, programId, null])}`,
    JSON.stringify({ kind, programId, bookId: null, baseRevision: programId === null ? 0 : 7, draft, updatedAt: at }), at);
  put("a", "simple", null, { name: "New old draft", weekCount: 2, workouts: [{ key: "new-w", name: "New workout", exercises: [exercise("new-e")] }] });
  put("b", "periodized", null, { name: "New old cycle", cycleType: "strength", repRange: "3-6", weekCount: 1, editingWeekIndex: 0, participantIds: [], sharedGroupId: null,
    weeks: [{ key: "new-week", type: "base", workouts: [{ key: "new-cycle-w", name: "New cycle workout", exercises: [exercise("new-cycle-e")] }] }] });
  put("a", "simple", "p-a", { name: "Existing old draft", weekCount: 2, workouts: [{ key: "w-a0", name: "Existing workout", exercises: [{ ...exercise("e-a0"),
    importedSets: [{ historyOriginId: "set-a0", plannedReps: "8-12", plannedWeight: "2,5", reps: "20", weight: "10", rpe: "8", completedAt: at, setKind: "working", effortOutcome: "normal" }] }] }] });
  db.exec("INSERT INTO training_programs SELECT 'template-rest',client_id,mode,'Template',cycle_type,settings_json,NULL,1,created_at,updated_at,deleted_at,'source-workspace' FROM training_programs WHERE id='p-b'; INSERT INTO training_weeks SELECT 'week-template','template-rest',week_index,week_type,label,data_json,deleted_at FROM training_weeks WHERE id='week-b0'; INSERT INTO training_workouts SELECT 'w-template',client_id,'template-rest','week-template',sort_index,name,data_json,created_at,updated_at,deleted_at FROM training_workouts WHERE id='w-b0'; INSERT INTO training_exercises SELECT 'e-template','w-template',sort_index,name,note,template_exercise_id,json_set(data_json,'$.restSeconds',0),deleted_at FROM training_exercises WHERE id='e-b0'");
}
const fixture = (run: Parameters<typeof nutritionFixture>[0], amend: (db: DatabaseSync) => void = () => undefined) => nutritionFixture(run, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }); seed(db); amend(db);
});
type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
const stage = (f: Fixture, checkpoint?: Parameters<typeof stageLegacyImportCandidate>[1]) => stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context,
  source: f.snapshots, importedAt, referenceDay, allocate: allocator() }, checkpoint);
const records = (file: string) => inspect(file, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name as string}`).all()]));
const alias = (file: string, id: string) => inspect(file, (db) => db.prepare("SELECT * FROM r04_plan_source WHERE source_row_id=?").get(id)!);
const rest = (file: string, id: string) => inspect(file, (db) => db.prepare("SELECT rest_sec FROM training_planned_exercises WHERE id=?").get(alias(file, id).target_id!)!.rest_sec);
function empty(file: string) { inspect(file, (db) => {
  for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_'").all()) if (!["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name as string)) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name as string}`).get()!.n, 0, name as string);
}); }

test("rest mapping keeps old default/off/bounds and never treats restSec as a source alias", () => {
  for (const [input, expected] of [[{}, 120], [{ restSeconds: 0 }, null], [{ restSeconds: 1 }, 1], [{ restSeconds: 1859 }, 1859], [{ restSec: 0 }, 120], [{ restSeconds: 0, restSec: 180 }, null]] as const) assert.equal(projectLegacyRest(input).seconds, expected);
  assert.equal(projectLegacyRest({}).basis, "LEGACY_DEFAULT_120"); assert.equal(projectLegacyRest({ restSeconds: 0 }).basis, "exercise.restSeconds");
  assert.deepEqual(projectLegacyRest({ restSec: 180 }).issues, ["REST_SEC_NOT_SOURCE_FIELD"]);
  for (const value of [null, "150", "", false, true, {}, [], -1, -0, 0.5, 1860, NaN, Infinity]) assert.throws(() => projectLegacyRest({ restSeconds: value }), { message: "R04_ID_LEDGER_PLANS_REST_UNREPRESENTABLE" });
});

test("plans, weekly overrides, archives, templates and recovered drafts retain source rest settings with explicit basis", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.executions.performedFacts, 6); assert.equal(result.owners.plans.builderDraftRows, 3);
  assert.equal(rest(f.stagePath, "e-a0"), null); assert.equal(rest(f.stagePath, "e-b0"), 1859);
  inspect(f.stagePath, (db) => {
    const override = JSON.parse(db.prepare("SELECT workout_json FROM training_simple_overrides").get()!.workout_json as string) as { exercises: { restSec: number | null }[] };
    assert.equal(override.exercises[0]!.restSec, 120);
    const raw = db.prepare("SELECT target_json FROM r04_plan_receipt").get()!.target_json as string;
    const saved = JSON.parse(raw) as { restProjectionVersion: number; planBases: string[]; metadata: string[] };
    assert.equal(saved.restProjectionVersion, 1); assert.ok(saved.planBases.some((r) => r.includes("LEGACY_DEFAULT_120"))); assert.ok(saved.planBases.some((r) => r.includes("REST_SEC_NOT_SOURCE_FIELD")));
    assert.ok(saved.planBases.map((r) => JSON.parse(r) as { sourceKey?: string; rest?: string }).some((r) => r.sourceKey?.includes("training_archive_entries") && r.rest === "exercise.restSeconds"));
    assert.equal(db.prepare("SELECT count(*) AS n FROM training_planned_exercises WHERE rest_sec=60").get()!.n, 1);
    const drafts = db.prepare("SELECT * FROM training_builder_drafts").all();
    const simple = JSON.parse(drafts.find((r) => r.draft_key === "new:SIMPLE")!.draft_json as string) as { draft: { plan: { workouts: { exercises: { restSec: number | null }[] }[] } } };
    assert.equal(simple.draft.plan.workouts[0]!.exercises[0]!.restSec, 120);
    const edited = JSON.parse(drafts.find((r) => r.base_revision === 1)!.draft_json as string) as typeof simple & { base: typeof simple.draft };
    assert.equal(edited.draft.plan.workouts[0]!.exercises[0]!.restSec, null); assert.equal(edited.base.plan.workouts[0]!.exercises[0]!.restSec, null);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });
  const before = records(f.stagePath); await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: () => assert.fail("rest replay allocated") });
  assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha);
}));

test("ambiguous/invalid source rest never rounds, coerces or activates a partial candidate", async () => {
  for (const value of [null, "150", false, 0.5, -1, 1860]) await fixture(async (f) => {
    await assert.rejects(stage(f), /PLANS_REST_UNREPRESENTABLE/u); empty(f.stagePath); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
  }, (db) => { const row = db.prepare("SELECT data_json FROM training_exercises WHERE id='e-b0'").get()!; const data = JSON.parse(row.data_json as string) as object; db.prepare("UPDATE training_exercises SET data_json=? WHERE id='e-b0'").run(JSON.stringify({ ...data, restSeconds: value })); });
  await fixture(async (f) => { await assert.rejects(stage(f), /NUMBER_UNREPRESENTABLE/u); empty(f.stagePath); assert.equal(digest(f.sourcePath), f.sha); },
    (db) => db.exec("UPDATE training_exercises SET data_json='{\"catalogId\":\"x\",\"restSeconds\":1.0000000000000001}' WHERE id='e-b0'"));
});

test("rest source capture, target drift and an old mode cannot rewrite a candidate or enable WAL", () => fixture(async (f) => {
  const source = structuredClone(f.snapshots), pending = stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() });
  const exercise = source.plans.tables.training_exercises!.find((r) => r.id === "e-b0")!; Object.assign(exercise, { data_json: '{"catalogId":"x","restSeconds":60}' }); await pending;
  const before = records(f.stagePath); await assert.rejects(stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() }), /EXERCISE_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), before);
  const id = alias(f.stagePath, "e-b0").target_id!; inspect(f.stagePath, (db) => db.prepare("UPDATE training_planned_exercises SET rest_sec=60 WHERE id=?").run(id)); const damaged = records(f.stagePath);
  await assert.rejects(stage(f), /PLANS_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), damaged);
  inspect(f.stagePath, (db) => { const mode = JSON.parse(db.prepare("SELECT context_json FROM r04_candidate_identity").get()!.context_json as string) as unknown[];
    assert.ok(mode.includes("TRAINING_REST_SETTINGS_REHEARSAL_V1")); db.prepare("UPDATE r04_candidate_identity SET context_json=?").run(JSON.stringify(mode.filter((v) => v !== "TRAINING_REST_SETTINGS_REHEARSAL_V1"))); });
  const hash = digest(f.stagePath), calls = f.native.calls.length; await assert.rejects(stage(f), /CONTEXT_MISMATCH/u); assert.equal(digest(f.stagePath), hash);
  assert.equal(f.native.calls.slice(calls).some((c) => /^PRAGMA\s+journal_mode\s*=/iu.test(c.sql)), false); assert.ok(f.native.calls.slice(0, calls).some((c) => /^PRAGMA\s+journal_mode\s*=/iu.test(c.sql)));
}));

test("rest rows roll back with all owners; commit acknowledgement loss replays without new IDs", async () => {
  for (const phase of ["after-plan-rows", "after-plan-receipt", "before-commit", "ack"] as const) await fixture(async (f) => {
    let committed = false, failed = false;
    if (phase === "ack") f.native.state.after = (c) => { if (committed && !failed && c.kind === "exec" && c.sql === "COMMIT") { failed = true; throw Error("PRIVATE acknowledgement"); } };
    await assert.rejects(stage(f, (at) => { if (at === "before-commit") committed = true; if (at === phase) throw Error("PRIVATE callback"); }), /WRITE_FAILED/u);
    if (phase === "ack") assert.equal(failed, true); else empty(f.stagePath); f.native.state.after = undefined;
    await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: phase === "ack" ? () => assert.fail("committed ID allocated") : allocator() });
    assert.equal(rest(f.stagePath, "e-b0"), 1859); assert.equal(rest(f.stagePath, "e-a0"), null); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("Expo SDK adapters resume after actual host Worker termination and retain off/default/custom rest", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), killed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start", killAt: "before-commit" }); assert.equal(killed.terminated, true);
  const jobId = killed.jobs[0]!.jobId, file = join(root, "legacy-import-jobs", jobId, "candidate.sqlite"); empty(file);
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true }); assert.equal(resumed.ok, true, resumed.code);
  assert.equal(rest(file, "e-b0"), 1859); assert.equal(rest(file, "e-a0"), null);
  const before = records(file), replay = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true, forbidAllocation: true });
  assert.equal(replay.ok, true, replay.code); assert.deepEqual(records(file), before); assert.equal(replay.handles, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("ordinary 3.x reads/edits restored rest and drafts after backup with the importer unavailable", () => fixture(async (f) => {
  await stage(f); const a = alias(f.stagePath, "p-a"), b = alias(f.stagePath, "p-b"), e = alias(f.stagePath, "e-a0"), t = alias(f.stagePath, "template-rest");
  const file = join(f.dir, "normal.sqlite"), db = new DatabaseSync(file);
  try {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => ({ ...nodeSqlitePort(db), close: async () => undefined })));
    for (const table of ["clients", ...TEMPLATE_TARGET_TABLES, "training_builder_drafts"]) for (const row of inspect(f.stagePath, (source) => source.prepare(`SELECT * FROM ${table}`).all())) {
      const columns = Object.keys(row); db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(row));
    }
    await createSqliteBackup(db, join(f.dir, "backup.partial"), join(f.dir, "native.atbackup"), { backupId: "88888888-8888-4888-8888-888888888888", createdAt: new Date(importedAt).toISOString() });
  } finally { db.close(); }
  const restored = join(f.dir, "restored.sqlite"); await prepareBackupForRestore(join(f.dir, "native.atbackup"), restored);
  const script = `import{parentPort,workerData as d}from'node:worker_threads';import{registerHooks}from'node:module';import{DatabaseSync}from'node:sqlite';
    registerHooks({resolve(s,c,n){const r=n(s,c);if(/legacy-import|shared\\/migration|scripts\\/r04\\//.test(r.url))throw Error('IMPORTER_REMOVED');return r;}});
    let blocked=false;try{await import(d.probe);}catch(e){blocked=e.message==='IMPORTER_REMOVED';}if(!blocked)throw Error('GUARD_INACTIVE');
    const{DevTrainingPlansRepository}=await import(d.reader),{SharedSqliteDatabase}=await import(d.shared),{nodeSqlitePort}=await import(d.port),{REST_DEFAULT_SEC}=await import(d.model),db=new DatabaseSync(d.file);
    const repo=new DevTrainingPlansRepository(new SharedSqliteDatabase(async()=>({...nodeSqlitePort(db),close:async()=>{}})),'local-trainer');await repo.initialize();
    const values=async()=>(await repo.getSimpleWeeks(d.a,d.ap)).map(w=>w.workouts[0].exercises[0].restSec),before=await values();
    const cycle=await repo.getPeriodizedPlan(d.b,d.bp),fresh=await repo.getBuilderDraft(d.a,'new:SIMPLE'),edited=await repo.getBuilderDraft(d.a,d.ap),periodic=await repo.getMesocycleBuilderDraft(d.b,{programId:null,mesocycleId:null}),template=await repo.getTemplate(d.template);
    await repo.setExerciseRest(d.a,d.ap,d.exercise,150);const after=await values(),created=await repo.createSimpleProgram(d.a,fresh.draft),createdPlan=await repo.getSimplePlan(d.a,created.id);
    parentPort.postMessage({blocked,before,after,cycle:cycle.mesocycles[0].weeks[0].workouts[0].exercises[0].restSec,newDraft:fresh.draft.plan.workouts[0].exercises[0].restSec,
      edited:edited.draft.plan.workouts[0].exercises[0].restSec,base:edited.base.plan.workouts[0].exercises[0].restSec,newCycle:periodic.weeks[0].workouts[0].exercises[0].restSec,
      template:template.payload.mesocycle.weeks[0].workouts[0].exercises[0].restSec,published:createdPlan.draft.plan.workouts[0].exercises[0].restSec,newAppDefault:REST_DEFAULT_SEC});await repo.close();db.close();`;
  const observed = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), { execArgv: ["--experimental-strip-types"], workerData: { file: restored,
      a: a.target_client_id, ap: a.target_program_id, b: b.target_client_id, bp: b.target_program_id, exercise: e.target_id, template: t.target_id,
      probe: new URL("../apps/mobile/src/features/training/plans/domain/legacy-import/LegacyPlanPrescription.ts", import.meta.url).href,
      reader: new URL("../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts", import.meta.url).href,
      model: new URL("../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts", import.meta.url).href,
      shared: new URL("../apps/mobile/src/shared/db/SharedSqliteDatabase.ts", import.meta.url).href, port: new URL("./support/node-sqlite-port.ts", import.meta.url).href } });
    let result: unknown; worker.once("message", (v: unknown) => { result = v; }); worker.once("error", reject);
    worker.once("exit", (code) => code || result === undefined ? reject(new Error(`REST_READER_EXIT_${code}`)) : resolve(result));
  });
  assert.deepEqual(observed, { blocked: true, before: [null, 120], after: [150, 120], cycle: 1859, newDraft: 120, edited: null, base: null, newCycle: 120, template: null, published: 120, newAppDefault: 90 });
  assert.equal(digest(f.sourcePath), f.sha);
}));
