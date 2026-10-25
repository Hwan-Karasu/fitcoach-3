import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { TEMPLATE_TARGET_TABLES } from "../apps/mobile/src/features/training/plans/domain/legacy-import/LegacyPlansProjection.ts";
import { fixture as nutritionFixture, referenceDay } from "./support/legacy-nutrition-staging.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";
import { runLegacyJobWorker } from "./support/legacy-job-worker.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { createSqliteBackup, prepareBackupForRestore } from "./r06/SqliteBackup.ts";

function seed(db: DatabaseSync) {
  db.exec("UPDATE training_programs SET settings_json=json_set(settings_json,'$.totalWeeks',2) WHERE id='p-b'; UPDATE training_exercises SET note='Source instruction' WHERE id='e-b0'");
  db.exec("INSERT INTO training_weeks VALUES('week-b1','p-b',1,'heavy','Week 2','{}',NULL)");
  db.exec("INSERT INTO training_workouts SELECT 'w-b1',client_id,program_id,'week-b1',sort_index,name,data_json,created_at,updated_at,deleted_at FROM training_workouts WHERE id='w-b0'");
  db.exec("INSERT INTO training_exercises SELECT 'e-b1','w-b1',sort_index,name,note,template_exercise_id,data_json,deleted_at FROM training_exercises WHERE id='e-b0'");
  db.exec("INSERT INTO training_set_logs SELECT 'set-b1','e-b1',set_index,reps,weight,rpe,completed_at,json_remove(data_json,'$.historyOriginId'),deleted_at,set_kind,effort_outcome FROM training_set_logs WHERE id='set-b0'");
  db.exec("INSERT INTO training_set_segments SELECT 'segment-set-b1','set-b1',segment_index,reps,weight,deleted_at FROM training_set_segments WHERE set_log_id='set-b0'");
}
function shared(db: DatabaseSync) {
  db.exec(`UPDATE training_programs SET settings_json=json_set(settings_json,'$.sharedGroupId','family','$.participantIds',json('["a","b"]')) WHERE id='p-b';
    INSERT INTO training_programs SELECT 'p-a-shared','a',mode,'Shared copy',cycle_type,settings_json,NULL,is_template,created_at,updated_at,deleted_at,template_workspace_id FROM training_programs WHERE id='p-b'`);
  for (let i = 0; i < 2; i++) {
    db.prepare("INSERT INTO training_weeks SELECT ?,'p-a-shared',week_index,week_type,label,data_json,deleted_at FROM training_weeks WHERE id=?").run(`week-a-shared${i}`, `week-b${i}`);
    db.prepare("INSERT INTO training_workouts SELECT ?,'a','p-a-shared',?,sort_index,name,data_json,created_at,updated_at,deleted_at FROM training_workouts WHERE id=?").run(`w-a-shared${i}`, `week-a-shared${i}`, `w-b${i}`);
    db.prepare("INSERT INTO training_exercises SELECT ?,?,sort_index,name,note,template_exercise_id,data_json,deleted_at FROM training_exercises WHERE id=?").run(`e-a-shared${i}`, `w-a-shared${i}`, `e-b${i}`);
    // The observed shared clone contains plans, not another person's results.
    db.prepare("INSERT INTO training_set_logs SELECT ?,?,set_index,'','','',NULL,'{\"plannedReps\":\"8-12\",\"plannedWeight\":\"2,5\",\"targetWeight\":\"2,5\"}',deleted_at,set_kind,effort_outcome FROM training_set_logs WHERE id=?").run(`set-a-shared${i}`, `e-a-shared${i}`, `set-b${i}`);
  }
}
const fixture = (run: Parameters<typeof nutritionFixture>[0], amend: (db: DatabaseSync) => void = () => undefined) => nutritionFixture(run, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }); seed(db); amend(db);
});
type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
const stage = (f: Fixture, checkpoint?: Parameters<typeof stageLegacyImportCandidate>[1]) => stageLegacyImportCandidate({ openStaging: f.native.open,
  context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() }, checkpoint);
const records = (file: string) => inspect(file, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name as string}`).all()]));
const alias = (file: string, id: string) => inspect(file, (db) => db.prepare("SELECT * FROM r04_plan_source WHERE source_row_id=?").get(id)!);
const lineage = (file: string, table: string, id: string) => inspect(file, (db) => db.prepare(`SELECT lineage_id FROM ${table} WHERE id=?`).get(alias(file, id).target_id!)!.lineage_id);
const receipt = (file: string) => inspect(file, (db) => db.prepare("SELECT target_json FROM r04_plan_receipt").get()!.target_json as string);
function empty(file: string) { inspect(file, (db) => {
  for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_'").all()) if (!["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name as string)) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name as string}`).get()!.n, 0, name as string);
}); }

test("unambiguous source scope groups gain native lineage while identical performed facts and physical plan IDs stay separate", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.plans.linkedWorkoutGroups, 1); assert.equal(result.owners.plans.linkedExerciseGroups, 1);
  assert.equal(result.owners.executions.performedFacts, 7); assert.equal(result.owners.plans.lineageReviewGroups, 0);
  assert.equal(lineage(f.stagePath, "training_workouts", "w-b0"), lineage(f.stagePath, "training_workouts", "w-b1"));
  assert.equal(lineage(f.stagePath, "training_planned_exercises", "e-b0"), lineage(f.stagePath, "training_planned_exercises", "e-b1"));
  for (const [a, b] of [["w-b0", "w-b1"], ["e-b0", "e-b1"], ["set-b0", "set-b1"]]) assert.notEqual(alias(f.stagePath, a!).target_id, alias(f.stagePath, b!).target_id);
  inspect(f.stagePath, (db) => {
    const facts = db.prepare("SELECT id,reps,load_grams FROM r04_execution_facts WHERE client_id=? AND source_fact_id IN ('set-a0','set-b1')").all(alias(f.stagePath, "e-b0").target_client_id!);
    assert.equal(facts.length, 2); assert.notEqual(facts[0]!.id, facts[1]!.id); assert.ok(facts.every((r) => r.reps === 20 && r.load_grams === 10000));
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });
  const saved = JSON.parse(receipt(f.stagePath)) as { metadata: string[]; scopeLineageProjectionVersion: number };
  assert.equal(saved.scopeLineageProjectionVersion, 1);
  const archived = saved.metadata.map((text) => JSON.parse(text) as Record<string, unknown>).find((m) => m.archiveScopeLineages);
  assert.ok(archived); assert.equal(JSON.stringify(archived).includes("ARCHIVE_PLAN_ADAPTER_V1"), false);
  assert.ok(JSON.stringify(archived).includes("training_archive_entries"));
  const before = records(f.stagePath), source = structuredClone(f.snapshots);
  for (const rows of Object.values(source.plans.tables)) if (rows !== null) (rows as unknown[]).reverse();
  await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: () => assert.fail("lineage replay allocated") });
  assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("trimmed-name/position disagreement and duplicate workouts remain explicit scope review", async () => {
  for (const kind of ["position", "spaces", "duplicate"] as const) await fixture(async (f) => {
    const result = await stage(f); assert.ok(result.owners.plans.lineageReviewGroups > 0); assert.equal(result.owners.plans.linkedWorkoutGroups, 0);
    assert.notEqual(lineage(f.stagePath, "training_workouts", "w-b0"), lineage(f.stagePath, "training_workouts", "w-b1"));
    assert.ok(receipt(f.stagePath).includes(kind === "duplicate" ? "WORKOUT_SCOPE_AMBIGUOUS" : "WORKOUT_SELECTORS_DISAGREE"));
    assert.equal(result.owners.executions.performedFacts, 7);
  }, (db) => {
    if (kind === "position") db.exec("UPDATE training_workouts SET sort_index=5 WHERE id='w-b1'");
    else if (kind === "spaces") db.exec("UPDATE training_workouts SET name=' '||name WHERE id='w-b1'");
    else db.exec("INSERT INTO training_workouts SELECT 'duplicate-workout',client_id,program_id,week_id,1,name,data_json,created_at,updated_at,deleted_at FROM training_workouts WHERE id='w-b0'");
  });
});

test("two occurrences of the same catalog exercise are never paired by ordinal or metrics", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.plans.linkedWorkoutGroups, 1); assert.equal(result.owners.plans.linkedExerciseGroups, 0);
  const a = lineage(f.stagePath, "training_planned_exercises", "e-b0"), b = lineage(f.stagePath, "training_planned_exercises", "e-b1"), duplicate = lineage(f.stagePath, "training_planned_exercises", "duplicate-exercise");
  assert.equal(new Set([a, b, duplicate]).size, 3); assert.ok(receipt(f.stagePath).includes("EXERCISE_SCOPE_AMBIGUOUS"));
  assert.equal(result.owners.executions.performedFacts, 7); assert.equal(digest(f.sourcePath), f.sha);
}, (db) => db.exec("INSERT INTO training_exercises SELECT 'duplicate-exercise',workout_id,1,name,note,template_exercise_id,data_json,deleted_at FROM training_exercises WHERE id='e-b0'")));

test("the same catalog exercise in two different workout groups keeps separate edit lineage", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.plans.linkedWorkoutGroups, 2); assert.equal(result.owners.plans.linkedExerciseGroups, 2);
  assert.equal(lineage(f.stagePath, "training_planned_exercises", "e-other0"), lineage(f.stagePath, "training_planned_exercises", "e-other1"));
  assert.notEqual(lineage(f.stagePath, "training_planned_exercises", "e-other0"), lineage(f.stagePath, "training_planned_exercises", "e-b0"));
  assert.equal(result.owners.executions.performedFacts, 7);
}, (db) => {
  for (let i = 0; i < 2; i++) {
    db.prepare("INSERT INTO training_workouts SELECT ?,client_id,program_id,week_id,1,'Other workout',data_json,created_at,updated_at,deleted_at FROM training_workouts WHERE id=?").run(`w-other${i}`, `w-b${i}`);
    db.prepare("INSERT INTO training_exercises SELECT ?,?,sort_index,name,note,template_exercise_id,data_json,deleted_at FROM training_exercises WHERE id=?").run(`e-other${i}`, `w-other${i}`, `e-b${i}`);
  }
}));

test("two private mesocycles of one client/book do not gain shared lineage from matching labels and slots", () => fixture(async (f) => {
  await stage(f); assert.equal(alias(f.stagePath, "p-b").target_program_id, alias(f.stagePath, "p-b-other").target_program_id);
  assert.notEqual(lineage(f.stagePath, "training_workouts", "w-b0"), lineage(f.stagePath, "training_workouts", "w-b-other"));
  assert.notEqual(lineage(f.stagePath, "training_planned_exercises", "e-b0"), lineage(f.stagePath, "training_planned_exercises", "e-b-other"));
}, (db) => {
  db.exec("UPDATE training_programs SET book_id='book-b',settings_json=json_set(settings_json,'$.pageIndex',0) WHERE id='p-b'");
  db.exec("INSERT INTO training_programs SELECT 'p-b-other',client_id,mode,name,cycle_type,json_set(settings_json,'$.totalWeeks',1,'$.pageIndex',1),book_id,is_template,created_at,updated_at,deleted_at,template_workspace_id FROM training_programs WHERE id='p-b'");
  db.exec("INSERT INTO training_weeks VALUES('week-b-other','p-b-other',0,'base','Week','{}',NULL)");
  db.exec("INSERT INTO training_workouts SELECT 'w-b-other',client_id,'p-b-other','week-b-other',sort_index,name,data_json,created_at,updated_at,deleted_at FROM training_workouts WHERE id='w-b0'");
  db.exec("INSERT INTO training_exercises SELECT 'e-b-other','w-b-other',sort_index,name,note,template_exercise_id,data_json,deleted_at FROM training_exercises WHERE id='e-b0'");
}));

test("reciprocal shared pages preserve related descendants across participants without sharing their physical rows or facts", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.plans.linkedWorkoutGroups, 1); assert.equal(result.owners.plans.linkedExerciseGroups, 1);
  const exercises = ["e-b0", "e-b1", "e-a-shared0", "e-a-shared1"], workouts = ["w-b0", "w-b1", "w-a-shared0", "w-a-shared1"];
  assert.equal(new Set(exercises.map((id) => lineage(f.stagePath, "training_planned_exercises", id))).size, 1);
  assert.equal(new Set(workouts.map((id) => lineage(f.stagePath, "training_workouts", id))).size, 1);
  assert.equal(new Set(exercises.map((id) => alias(f.stagePath, id).target_id)).size, 4); assert.equal(result.owners.executions.performedFacts, 7);
  assert.notEqual(alias(f.stagePath, "p-b").target_program_id, alias(f.stagePath, "p-a-shared").target_program_id);
  assert.equal(digest(f.sourcePath), f.sha);
}, shared));

test("matching labels/catalogs without shared membership do not link different pages or clients; a stale shared set is rejected", async () => {
  await fixture(async (f) => {
    await stage(f); assert.notEqual(lineage(f.stagePath, "training_workouts", "w-b0"), lineage(f.stagePath, "training_workouts", "w-a-shared0"));
    assert.notEqual(lineage(f.stagePath, "training_planned_exercises", "e-b0"), lineage(f.stagePath, "training_planned_exercises", "e-a-shared0"));
  }, (db) => { shared(db); db.exec("UPDATE training_programs SET settings_json=json_remove(settings_json,'$.sharedGroupId','$.participantIds') WHERE id IN ('p-b','p-a-shared')"); });
  await fixture(async (f) => {
    await assert.rejects(stage(f), /SHARED_MEMBERSHIP_CONFLICT/u); empty(f.stagePath); assert.equal(digest(f.sourcePath), f.sha);
  }, (db) => { shared(db); db.exec("UPDATE training_programs SET settings_json=json_set(settings_json,'$.participantIds',json('[\"a\"]')) WHERE id='p-a-shared'"); });
});

test("shared navigation's index fallback cannot merge differently named workouts without a scope review", () => fixture(async (f) => {
  const result = await stage(f); assert.ok(result.owners.plans.lineageReviewGroups > 0);
  assert.notEqual(lineage(f.stagePath, "training_workouts", "w-b0"), lineage(f.stagePath, "training_workouts", "w-a-shared0"));
  assert.ok(receipt(f.stagePath).includes("SHARED_COUNTERPART_NAME_DIFFERS")); assert.equal(result.owners.executions.performedFacts, 7);
}, (db) => { shared(db); db.exec("UPDATE training_workouts SET name='Personal label' WHERE program_id='p-a-shared'"); }));

test("lineage identity/row/receipt checkpoints roll back all owners and permit a stable retry", async () => {
  for (const phase of ["after-plan-ids", "after-plan-rows", "after-plan-receipt", "before-commit"] as const) await fixture(async (f) => {
    await assert.rejects(stage(f, (at) => { if (at === phase) throw Error("PRIVATE callback"); }), /WRITE_FAILED/u); empty(f.stagePath);
    assert.equal((await stage(f)).owners.plans.linkedExerciseGroups, 1); const before = records(f.stagePath);
    await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: () => assert.fail("retry allocated") });
    assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("lineage tamper cannot be repaired by replay and an older mode is rejected before WAL", () => fixture(async (f) => {
  await stage(f); const target = alias(f.stagePath, "w-b1");
  inspect(f.stagePath, (db) => db.prepare("UPDATE training_workouts SET lineage_id='damaged' WHERE id=?").run(target.target_id!)); const damaged = records(f.stagePath);
  await assert.rejects(stage(f), /PLANS_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), damaged);
  inspect(f.stagePath, (db) => {
    const current = JSON.parse(db.prepare("SELECT context_json FROM r04_candidate_identity").get()!.context_json as string) as unknown[];
    assert.ok(current.includes("TRAINING_SCOPE_LINEAGES_REHEARSAL_V1"));
    db.prepare("UPDATE r04_candidate_identity SET context_json=?").run(JSON.stringify(current.filter((v) => v !== "TRAINING_SCOPE_LINEAGES_REHEARSAL_V1")));
  });
  const before = digest(f.stagePath), count = f.native.calls.length; await assert.rejects(stage(f), /CONTEXT_MISMATCH/u);
  assert.equal(digest(f.stagePath), before); assert.equal(f.native.calls.slice(count).some((c) => /^PRAGMA\s+journal_mode\s*=/iu.test(c.sql)), false);
  assert.ok(f.native.calls.slice(0, count).some((c) => /^PRAGMA\s+journal_mode\s*=/iu.test(c.sql))); assert.equal(f.native.handles.size, 0);
}));

test("Expo runtime restart after actual host Worker termination retains scope groups and independent facts", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), killed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start", killAt: "before-commit" });
  assert.equal(killed.terminated, true); const jobId = killed.jobs[0]!.jobId, file = join(root, "legacy-import-jobs", jobId, "candidate.sqlite"); empty(file);
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true }); assert.equal(resumed.ok, true, resumed.code);
  assert.equal(resumed.counts![0], 7); assert.equal(lineage(file, "training_planned_exercises", "e-b0"), lineage(file, "training_planned_exercises", "e-b1"));
  const before = records(file), replay = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true, forbidAllocation: true });
  assert.equal(replay.ok, true, replay.code); assert.equal(replay.handles, 0); assert.deepEqual(records(file), before); assert.equal(digest(f.sourcePath), f.sha);
}));

test("normal 3.x scoped editing after backup works across restored weeks/participants and preserves personal changes without the importer", () => fixture(async (f) => {
  await stage(f); const a = alias(f.stagePath, "p-a-shared"), b = alias(f.stagePath, "p-b"), file = join(f.dir, "normal.sqlite"), db = new DatabaseSync(file);
  try {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => ({ ...nodeSqlitePort(db), close: async () => undefined })));
    for (const table of ["clients", ...TEMPLATE_TARGET_TABLES]) for (const row of inspect(f.stagePath, (source) => source.prepare(`SELECT * FROM ${table}`).all())) {
      const columns = Object.keys(row); db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(row));
    }
    await createSqliteBackup(db, join(f.dir, "backup.partial"), join(f.dir, "native.atbackup"), { backupId: "88888888-8888-4888-8888-888888888888", createdAt: new Date(importedAt).toISOString() });
  } finally { db.close(); }
  const restored = join(f.dir, "restored.sqlite"); await prepareBackupForRestore(join(f.dir, "native.atbackup"), restored);
  const script = `import{parentPort,workerData as d}from'node:worker_threads';import{registerHooks}from'node:module';import{DatabaseSync}from'node:sqlite';
    registerHooks({resolve(s,c,n){const r=n(s,c);if(/legacy-import|shared\\/migration|scripts\\/r04\\//.test(r.url))throw Error('IMPORTER_REMOVED');return r;}});
    let blocked=false;try{await import(d.probe);}catch(e){blocked=e.message==='IMPORTER_REMOVED';}if(!blocked)throw Error('GUARD_INACTIVE');
    const{DevTrainingPlansRepository}=await import(d.reader),{SharedSqliteDatabase}=await import(d.shared),{nodeSqlitePort}=await import(d.port),db=new DatabaseSync(d.file);
    const repo=new DevTrainingPlansRepository(new SharedSqliteDatabase(async()=>({...nodeSqlitePort(db),close:async()=>{}})),'local-trainer');await repo.initialize();
    const input=(plan,cycle,week,note,clients)=>({mesocycleId:cycle,weekIndex:week,type:plan.mesocycles[0].weeks[week-1].type,scope:'ALL',clientIds:clients,
      workouts:plan.mesocycles[0].weeks[week-1].workouts.map(w=>({...w,exercises:w.exercises.map(e=>({...e,instruction:note}))}))});
    const ids=()=>db.prepare('SELECT id,lineage_id FROM training_planned_exercises ORDER BY id').all(),beforeIds=JSON.stringify(ids());
    const initial=await repo.getPeriodizedPlan(d.bClient,d.bProgram),change=input(initial,d.bCycle,1,'Group edit',[d.aClient,d.bClient]);
    const preview=await repo.previewWeekEdit(d.bClient,d.bProgram,initial.program.revision,change);await repo.saveWeek(d.bClient,d.bProgram,initial.program.revision,change);
    const own=await repo.getPeriodizedPlan(d.aClient,d.aProgram),personal={...input(own,d.aCycle,2,'Personal',[d.aClient]),scope:'CURRENT'};await repo.saveWeek(d.aClient,d.aProgram,own.program.revision,personal);
    const current=await repo.getPeriodizedPlan(d.bClient,d.bProgram),next=input(current,d.bCycle,1,'Next group edit',[d.aClient,d.bClient]);
    const conflicts=await repo.previewWeekEdit(d.bClient,d.bProgram,current.program.revision,next);await repo.saveWeek(d.bClient,d.bProgram,current.program.revision,next);
    const aa=await repo.getPeriodizedPlan(d.aClient,d.aProgram),bb=await repo.getPeriodizedPlan(d.bClient,d.bProgram),notes=p=>p.mesocycles[0].weeks.map(w=>w.workouts[0].exercises[0].instruction);
    parentPort.postMessage({blocked,initialConflicts:preview.conflicts.length,personalConflicts:conflicts.conflicts.length,a:notes(aa),b:notes(bb),idsKept:beforeIds===JSON.stringify(ids())});await repo.close();db.close();`;
  const observed = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), { execArgv: ["--experimental-strip-types"], workerData: {
      file: restored, aClient: a.target_client_id, aProgram: a.target_program_id, aCycle: a.target_id, bClient: b.target_client_id, bProgram: b.target_program_id, bCycle: b.target_id,
      probe: new URL("../apps/mobile/src/features/training/plans/domain/legacy-import/LegacyScopeLineages.ts", import.meta.url).href,
      reader: new URL("../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts", import.meta.url).href,
      shared: new URL("../apps/mobile/src/shared/db/SharedSqliteDatabase.ts", import.meta.url).href, port: new URL("./support/node-sqlite-port.ts", import.meta.url).href } });
    let result: unknown; worker.once("message", (v: unknown) => { result = v; }); worker.once("error", reject);
    worker.once("exit", (code) => code || result === undefined ? reject(new Error(`SCOPE_READER_EXIT_${code}`)) : resolve(result));
  });
  assert.deepEqual(observed, { blocked: true, initialConflicts: 0, personalConflicts: 1, a: ["Next group edit", "Personal"], b: ["Next group edit", "Next group edit"], idsKept: true });
  assert.equal(digest(f.sourcePath), f.sha);
}, shared));
