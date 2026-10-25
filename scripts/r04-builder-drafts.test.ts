import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacyLoadPlanMappingsPlan } from "../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStagePlan.ts";
import { runNodeLegacyWritePlan } from "./r04/NodeLegacyWritePlan.ts";
import { owners } from "./support/legacy-training-staging.ts";
import { fixture as nutritionFixture, referenceDay } from "./support/legacy-nutrition-staging.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";
import { runLegacyJobWorker } from "./support/legacy-job-worker.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { createSqliteBackup, prepareBackupForRestore } from "./r06/SqliteBackup.ts";
import { TEMPLATE_TARGET_TABLES } from "../apps/mobile/src/features/training/plans/domain/legacy-import/LegacyPlansProjection.ts";
import { storedBuilderDraft, storedMesocycleBuilder } from "../apps/mobile/src/features/training/plans/domain/StoredPlanShape.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";

const sourceTime = "2026-03-01T12:00:00.000Z";
const exercise = (key: string) => ({ key, catalogId: "x", name: "Catalog exercise", setCount: 2, repRange: "8-12", rir: "1-2", plannedWeight: "2,5" });
const simple = () => ({ name: "Pending simple", weekCount: 4, workouts: [{ key: "new-workout", name: "Pending workout", exercises: [exercise("new-exercise")] }] });
const periodized = () => ({ name: "Pending cycle", cycleType: "strength", repRange: "3-6", weekCount: 2, editingWeekIndex: 1, participantIds: ["a"], sharedGroupId: null,
  weeks: [{ key: "new-week-1", type: "heavy", workouts: [{ key: "new-period-workout", name: "Pending heavy", exercises: [exercise("new-period-exercise")] }] }, { key: "new-week-2", type: "light", workouts: [] }] });
const slot = (client: string, kind: string, program: string | null, book: string | null = null) => `training_builder_draft_v2:${encodeURIComponent(client)}:${JSON.stringify([kind, program, book])}`;
function put(db: DatabaseSync, key: string, kind: string, draft: unknown, programId: string | null = null, bookId: string | null = null, baseRevision: number | null = 7) {
  db.prepare("INSERT INTO app_settings VALUES(?,?,?)").run(key, JSON.stringify({ kind, programId, bookId, baseRevision, draft, updatedAt: sourceTime }), sourceTime);
}
function seed(db: DatabaseSync) {
  db.exec("ALTER TABLE training_library_programs ADD COLUMN revision INTEGER; INSERT INTO training_library_programs SELECT id,client_id,name,mode,created_at,NULL,7 FROM training_programs");
  put(db, slot("a", "simple", null), "simple", simple(), null, null, 0);
  put(db, slot("b", "periodized", null), "periodized", periodized(), null, null, 0);
  const edited = { name: "Edited simple", weekCount: 2, workouts: [{ key: "w-a0", name: "Edited workout", exercises: [{ ...exercise("e-a0"), setCount: 1,
    importedSets: [{ historyOriginId: "set-a0", plannedReps: "10-12", plannedWeight: "3,5", reps: "20", weight: "10", rpe: "8", completedAt: sourceTime,
      setKind: "working", effortOutcome: "normal", segments: [{ reps: "20", weight: "10" }] }] }] }] };
  put(db, slot("a", "simple", "p-a"), "simple", edited, "p-a");
  const editCycle = { ...periodized(), name: "Edited cycle", weekCount: 1, editingWeekIndex: 0, participantIds: [], weeks: [{ key: "week-b0", type: "heavy",
    workouts: [{ key: "w-b0", name: "Edited cycle workout", exercises: [{ ...exercise("e-b0"), setCount: 1, importedSets: [{ historyOriginId: "set-a0", plannedReps: "6", plannedWeight: "4", reps: "20", weight: "10", rpe: "8", completedAt: sourceTime,
      setKind: "working", effortOutcome: "normal", segments: [{ reps: "20", weight: "10" }] }] }] }] }] };
  put(db, slot("b", "periodized", "p-b"), "periodized", editCycle, "p-b");
}
const fixture = (run: Parameters<typeof nutritionFixture>[0], amend: (db: DatabaseSync) => void = () => undefined) => nutritionFixture(run, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }); seed(db); amend(db);
});
type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
const stage = (f: Fixture, checkpoint?: Parameters<typeof stageLegacyImportCandidate>[1]) => stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() }, checkpoint);
const rows = (file: string) => inspect(file, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name as string}`).all()]));
const receipt = (f: Fixture) => inspect(f.stagePath, (db) => JSON.parse(db.prepare("SELECT target_json FROM r04_plan_receipt").get()!.target_json as string)) as {
  builderRepresentations: { sourceKey: string; disposition: string; reason: string | null; targetKey: string | null; raw: Record<string, unknown> }[];
};
function empty(f: Fixture) {
  inspect(f.stagePath, (db) => {
    for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_'").all()) if (!["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name as string)) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name as string}`).get()!.n, 0, name as string);
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  }); assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
}

test("new and existing simple/periodized builder drafts become native recovery records without publishing plans or duplicating facts", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.plans.builderDraftRows, 4); assert.equal(result.owners.plans.builderDraftReviewRows, 0);
  assert.equal(result.owners.executions.performedFacts, 6);
  inspect(f.stagePath, (db) => {
    const drafts = db.prepare("SELECT * FROM training_builder_drafts").all(); assert.equal(drafts.length, 4);
    for (const row of drafts) { const draft = JSON.parse(row.draft_json as string); assert.ok(storedBuilderDraft(draft) || storedMesocycleBuilder(draft)); }
    const fresh = JSON.parse(drafts.find((r) => r.draft_key === "new:SIMPLE")!.draft_json as string);
    assert.equal(fresh.draft.plan.workouts[0].exercises[0].sets[0].loadGrams, 2500); assert.equal(fresh.draft.plan.workouts[0].exercises[0].sets[0].repsMax, 12);
    const existing = drafts.find((r) => r.base_revision === 1 && storedBuilderDraft(JSON.parse(r.draft_json as string)))!, edited = JSON.parse(existing.draft_json as string);
    assert.equal(edited.base.title, "Программа a"); assert.equal(edited.draft.title, "Edited simple"); assert.equal(edited.draft.plan.workouts[0].id, edited.base.plan.workouts[0].id);
    assert.equal(edited.draft.plan.workouts[0].exercises[0].sets[0].id, edited.base.plan.workouts[0].exercises[0].sets[0].id);
    assert.equal(edited.draft.plan.workouts[0].exercises[0].sets[0].loadGrams, 3500);
    assert.equal(edited.draft.plan.workouts[0].exercises[0].sets[0].reps, 8);
    assert.equal(edited.draft.plan.workouts[0].exercises[0].sets[0].repsMax, 12);
    assert.equal(db.prepare("SELECT count(*) AS n FROM training_programs WHERE title LIKE 'Pending%'").get()!.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM training_periodized_drafts").get()!.n, 0);
    assert.equal(runNodeLegacyWritePlan(db, legacyLoadPlanMappingsPlan(true, true)).size > 0, true);
    assert.throws(() => runNodeLegacyWritePlan(db, legacyLoadPlanMappingsPlan(true)), /PARITY_MISMATCH/u);
  });
  const before = rows(f.stagePath); await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: () => assert.fail("draft replay allocated") });
  assert.deepEqual(rows(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha);
}));

test("scoped storage wins over the legacy single slot even if the scoped payload is invalid; distinct scopes remain independent", () => fixture(async (f) => {
  await stage(f); const all = receipt(f).builderRepresentations;
  assert.equal(all.find((r) => r.raw.key === "training_builder_draft:a")!.disposition, "SHADOWED");
  assert.equal(all.find((r) => r.raw.key === slot("a", "simple", null))!.disposition, "REVIEW_REQUIRED");
  assert.equal(all.filter((r) => r.disposition === "EDITABLE_DRAFT").length, 3);
  inspect(f.stagePath, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM training_builder_drafts WHERE draft_key='new:SIMPLE'").get()!.n, 0));
}, (db) => { put(db, "training_builder_draft:a", "simple", simple(), null, null, 0); db.prepare("UPDATE app_settings SET value='{broken' WHERE key=?").run(slot("a", "simple", null)); }));

test("existing supersets, explicitly declared plan slots, rest and instructions keep their proven native identities", () => fixture(async (f) => {
  await stage(f);
  inspect(f.stagePath, (db) => {
    const row = db.prepare("SELECT draft_json FROM training_builder_drafts WHERE draft_key NOT LIKE 'new:%' AND draft_key NOT LIKE 'builder:%'").get()!;
    const saved = JSON.parse(row.draft_json as string), draft = saved.draft.plan.workouts[0], base = saved.base.plan.workouts[0];
    assert.equal(draft.exercises[0].supersetId, base.exercises[0].supersetId); assert.equal(draft.exercises[1].supersetId, draft.exercises[0].supersetId);
    assert.deepEqual(draft.exercises[1].sets.map((s: { id: string }) => s.id), base.exercises[1].sets.map((s: { id: string }) => s.id));
    assert.equal(draft.exercises[0].restSec, 120); assert.equal(draft.exercises[0].instruction, "Keep original instruction");
  });
  const before = rows(f.stagePath); await stage(f); assert.deepEqual(rows(f.stagePath), before);
}, (db) => {
  db.exec("UPDATE training_exercises SET note='Keep original instruction',data_json=json_set(data_json,'$.supersetGroupId','group','$.restSec',120) WHERE id='e-a0'");
  db.exec("INSERT INTO training_exercises VALUES('e-extra','w-a0',1,'Second','','x','{\"catalogId\":\"x\",\"setCount\":2,\"supersetGroupId\":\"group\"}',NULL)");
  const key = slot("a", "simple", "p-a"), value = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key=?").get(key)!.value as string);
  value.draft.workouts[0].exercises[0].supersetGroupId = "group";
  value.draft.workouts[0].exercises.push({ ...exercise("e-extra"), supersetGroupId: "group" });
  db.prepare("UPDATE app_settings SET value=? WHERE key=?").run(JSON.stringify(value), key);
}));

test("stale revisions, unresolved catalog/owners, pending facts, invalid precision and unfinished copy actions stay explicit raw review", async () => {
  const changes: readonly ((v: Record<string, unknown>) => void)[] = [
    (v) => { v.baseRevision = 6; },
    (v) => { (v.draft as ReturnType<typeof simple>).workouts[0]!.exercises[0]!.catalogId = "missing"; },
    (v) => { const d = v.draft as { workouts: { exercises: { importedSets: { weight: string }[] }[] }[] }; d.workouts[0]!.exercises[0]!.importedSets[0]!.weight = "99"; },
    (v) => { Object.assign((v.draft as ReturnType<typeof simple>).workouts[0]!, { applyToAllWeeks: true }); },
    (v) => { Object.assign((v.draft as ReturnType<typeof simple>).workouts[0]!, { applyToAllWeeks: 1 }); },
    (v) => { Object.assign((v.draft as ReturnType<typeof simple>).workouts[0]!.exercises[0]!, { setCount: null }); },
    (v) => { const e = (v.draft as { workouts: { exercises: { importedSets: Record<string, unknown>[] }[] }[] }).workouts[0]!.exercises[0]!; e.importedSets[0]!.effortOutcome = "unsupported"; },
    (v) => { const e = (v.draft as { workouts: { exercises: { importedSets: Record<string, unknown>[] }[] }[] }).workouts[0]!.exercises[0]!;
      Object.assign(e.importedSets[0]!, { reps: "", weight: "", rpe: "", completedAt: null, segments: [], effortOutcome: "failure" }); },
  ];
  for (const change of changes) await fixture(async (f) => {
    const result = await stage(f); assert.equal(result.owners.plans.builderDraftRows, 3); assert.equal(result.owners.plans.builderDraftReviewRows, 1); assert.equal(result.owners.executions.performedFacts, 6);
    const row = receipt(f).builderRepresentations.find((r) => r.raw.key === slot("a", "simple", "p-a"))!;
    assert.equal(row.disposition, "REVIEW_REQUIRED"); assert.ok(row.reason?.startsWith("R04_ID_LEDGER_")); assert.equal(digest(f.sourcePath), f.sha);
  }, (db) => { const key = slot("a", "simple", "p-a"), value = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key=?").get(key)!.value as string); change(value); db.prepare("UPDATE app_settings SET value=? WHERE key=?").run(JSON.stringify(value), key); });
  await fixture(async (f) => { await stage(f); assert.ok(receipt(f).builderRepresentations.some((r) => r.disposition === "REVIEW_REQUIRED")); },
    (db) => db.prepare("UPDATE app_settings SET value=replace(value,'\"weekCount\":4','\"weekCount\":4.0000000000000001') WHERE key=?").run(slot("a", "simple", null)));
});

test("duplicate identities and cross-owner physical IDs cannot become resumable drafts", async () => {
  for (const mode of ["foreign", "duplicate", "missing"] as const) await fixture(async (f) => {
    const result = await stage(f); assert.equal(result.owners.plans.builderDraftRows, 3);
    const row = receipt(f).builderRepresentations.find((r) => r.raw.key === slot(mode === "missing" ? "missing" : "a", "simple", "p-a"))!;
    assert.match(row.reason!, mode === "foreign" ? /ENTITY_SCOPE_INVALID/u : mode === "missing" ? /OWNER_MISSING/u : /DUPLICATE_ENTITY/u);
    assert.equal(result.owners.executions.performedFacts, 6); assert.equal(digest(f.sourcePath), f.sha);
  }, (db) => { const key = slot("a", "simple", "p-a"), v = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key=?").get(key)!.value as string);
    if (mode === "foreign") v.draft.workouts[0].key = "w-b0"; else if (mode === "duplicate") v.draft.workouts.push(structuredClone(v.draft.workouts[0]));
    db.prepare("UPDATE app_settings SET value=?,key=? WHERE key=?").run(JSON.stringify(v), mode === "missing" ? slot("missing", "simple", "p-a") : key, key); });
});

test("builder rows participate in the Plans transaction, every boundary rolls them back and retry keeps all IDs", async () => {
  for (const phase of ["after-plan-rows", "after-plan-receipt", "after-execution-facts", "after-settings-receipt", "before-commit"] as const) await fixture(async (f) => {
    await assert.rejects(stage(f, (at) => { if (at === phase) throw new Error("PRIVATE interruption"); }), /WRITE_FAILED/u); empty(f);
    await stage(f); const before = rows(f.stagePath); await stage(f); assert.deepEqual(rows(f.stagePath), before);
  });
});

test("native draft, base envelope, source metadata and identity drift reject replay without overwriting the candidate", () => fixture(async (f) => {
  await stage(f);
  const key = "new:SIMPLE", original = inspect(f.stagePath, (db) => db.prepare("SELECT draft_json FROM training_builder_drafts WHERE draft_key=?").get(key)!.draft_json!);
  inspect(f.stagePath, (db) => db.prepare("UPDATE training_builder_drafts SET draft_json='{}' WHERE draft_key=?").run(key)); const damaged = rows(f.stagePath);
  await assert.rejects(stage(f), /PARITY_MISMATCH/u); assert.deepEqual(rows(f.stagePath), damaged);
  inspect(f.stagePath, (db) => db.prepare("UPDATE training_builder_drafts SET draft_json=? WHERE draft_key=?").run(original, key));
  const altered = structuredClone(f.snapshots); Object.assign(altered.settings.rows!.find((r) => r.key === slot("a", "simple", null))!, { value: "{changed" });
  await assert.rejects(stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: altered, importedAt, referenceDay, allocate: allocator() }), /IDENTITY_MISMATCH|PARITY_MISMATCH/u);
  assert.equal(digest(f.sourcePath), f.sha);
}));

test("builder-enabled mode cannot upgrade an existing plan-only candidate or weaken the before-WAL guard", () => fixture(async (f) => {
  await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owners(f.snapshots)); const before = digest(f.stagePath), count = f.native.calls.length;
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, owners(f.snapshots, true)), /CONTEXT_MISMATCH/u);
  assert.equal(digest(f.stagePath), before); assert.equal(f.native.calls.slice(count).some((c) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(c.sql)), false);
  assert.ok(f.native.calls.slice(0, count).some((c) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(c.sql))); assert.equal(f.native.handles.size, 0);
}));

test("draft ID allocation collisions escape recoverable JSON handling and roll back the entire job", () => fixture(async (f) => {
  await stage(f);
  const ids = inspect(f.stagePath, (db) => db.prepare("SELECT * FROM r04_plan_ids ORDER BY rowid").all());
  const draftId = ids.find((r) => (r.source_key as string).includes('"builder-draft"'))!.target_id;
  const regularId = ids.find((r) => !(r.source_key as string).includes('"builder-draft"'))!.target_id as string;
  const path = join(f.dir, "collision.sqlite"), native = nativeFactory(path), next = allocator(); let collided = false;
  await assert.rejects(stageLegacyImportCandidate({ openStaging: native.open, context: f.context, source: f.snapshots, importedAt, referenceDay,
    allocate: () => { const value = next(); if (value === draftId) { collided = true; return regularId; } return value; } }), /PLANS_IDENTITY_COLLISION/u);
  assert.equal(collided, true); empty({ ...f, stagePath: path, native });
}));

test("native recovery-row insertion failures roll back every owner and can be retried", () => fixture(async (f) => {
  let failed = false; f.native.state.fail = (call) => { if (!failed && call.kind === "run" && call.sql.startsWith("INSERT INTO training_builder_drafts(")) { failed = true; return true; } return false; };
  await assert.rejects(stage(f), /WRITE_FAILED/u); assert.equal(failed, true); empty(f);
  f.native.state.fail = undefined; assert.equal((await stage(f)).owners.plans.builderDraftRows, 4);
}));

test("actual Expo runtime resumes source drafts from disk without allocating or reopening the selected backup", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), started = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start" }); assert.equal(started.ok, true, started.code);
  const job = started.jobs[0]!, candidate = join(root, "legacy-import-jobs", job.jobId, "candidate.sqlite"), before = rows(candidate);
  inspect(candidate, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM training_builder_drafts").get()!.n, 4));
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, forbidSource: true, forbidAllocation: true });
  assert.equal(resumed.ok, true, resumed.code); assert.equal(resumed.issued, 0); assert.deepEqual(rows(candidate), before); assert.equal(resumed.handles, 0);
}));

test("host Worker termination before commit rolls back draft rows; a fresh runtime completes and replays without duplicate facts", () => fixture(async (f) => {
  const root = join(f.dir, "killed-documents"), killed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start", killAt: "before-commit" });
  assert.equal(killed.terminated, true); const job = killed.jobs[0]!, target = join(root, "legacy-import-jobs", job.jobId, "candidate.sqlite");
  empty({ ...f, stagePath: target });
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, forbidSource: true }); assert.equal(resumed.ok, true, resumed.code); assert.deepEqual(resumed.counts, [6, 12, 4, 4]);
  inspect(target, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM training_builder_drafts").get()!.n, 4)); const before = rows(target);
  const replay = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, forbidSource: true, forbidAllocation: true });
  assert.equal(replay.ok, true, replay.code); assert.deepEqual(rows(target), before); assert.equal(replay.handles, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("normal constructors read, edit and publish restored native drafts after a 3.x snapshot with the importer unavailable", () => fixture(async (f) => {
  await stage(f); const live = join(f.dir, "normal.sqlite"), db = new DatabaseSync(live);
  try {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => ({ ...nodeSqlitePort(db), close: async () => undefined })));
    for (const table of ["clients", ...TEMPLATE_TARGET_TABLES, "training_builder_drafts"]) for (const row of inspect(f.stagePath, (source) => source.prepare(`SELECT * FROM ${table}`).all())) {
      const columns = Object.keys(row); db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(row));
    }
    await createSqliteBackup(db, join(f.dir, "backup.partial"), join(f.dir, "native.atbackup"), { backupId: "88888888-8888-4888-8888-888888888888", createdAt: new Date(importedAt).toISOString() });
  } finally { db.close(); }
  const restored = join(f.dir, "restored.sqlite"); await prepareBackupForRestore(join(f.dir, "native.atbackup"), restored);
  const script = `import {parentPort,workerData} from 'node:worker_threads';import {DatabaseSync} from 'node:sqlite';import {registerHooks} from 'node:module';
    registerHooks({resolve(s,c,n){const r=n(s,c);if(/legacy-import|shared\\/migration|scripts\\/r04\\//.test(r.url))throw Error('IMPORTER_REMOVED');return r;}});
    let blocked=false;try{await import(workerData.probe);}catch(e){blocked=e.message==='IMPORTER_REMOVED';}if(!blocked)throw Error('GUARD_INACTIVE');
    const {DevTrainingPlansRepository}=await import(workerData.reader),{SharedSqliteDatabase}=await import(workerData.shared),{nodeSqlitePort}=await import(workerData.port);
    const db=new DatabaseSync(workerData.file),repo=new DevTrainingPlansRepository(new SharedSqliteDatabase(async()=>({...nodeSqlitePort(db),close:async()=>undefined})),'local-trainer');await repo.initialize();
    const records=db.prepare('SELECT * FROM training_builder_drafts').all(),fresh=records.find(r=>r.draft_key==='new:SIMPLE'),cycle=records.find(r=>r.draft_key==='new:PERIODIZED');
    const a=await repo.getBuilderDraft(fresh.client_id,'new:SIMPLE'),b=await repo.getMesocycleBuilderDraft(cycle.client_id,{programId:null,mesocycleId:null});
    const created=await repo.createSimpleProgram(fresh.client_id,{...a.draft,title:'Published recovered simple'});
    const edit=records.find(r=>r.base_revision===1&&!r.draft_key.startsWith('builder:')),saved=await repo.getBuilderDraft(edit.client_id,edit.draft_key);
    await repo.saveBuilderDraft(edit.client_id,edit.draft_key,saved.baseRevision,{...saved.draft,title:'Edited recovered draft'},saved.base);
    const modified=await repo.getBuilderDraft(edit.client_id,edit.draft_key);await repo.saveSimplePlan(edit.client_id,edit.draft_key,1,modified.draft);
    const answer={blocked,created:created.title,modified:modified.draft.title,base:modified.base.title,cycle:b.title,members:b.members.length,editing:b.editing,startDate:b.startDate,week2:b.weeks[1].workouts.length};
    await repo.close();db.close();parentPort.postMessage(answer);`;
  const observed = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), { execArgv: ["--experimental-strip-types"], workerData: { file: restored,
      probe: new URL("../apps/mobile/src/features/training/plans/domain/legacy-import/LegacyBuilderDrafts.ts", import.meta.url).href,
      reader: new URL("../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts", import.meta.url).href,
      shared: new URL("../apps/mobile/src/shared/db/SharedSqliteDatabase.ts", import.meta.url).href,
      port: new URL("./support/node-sqlite-port.ts", import.meta.url).href } });
    let result: unknown; worker.once("message", (v: unknown) => { result = v; }); worker.once("error", reject);
    worker.once("exit", (code) => code || result === undefined ? reject(new Error(`DRAFT_READER_EXIT_${code}`)) : resolve(result));
  });
  assert.deepEqual(observed, { blocked: true, created: "Published recovered simple", modified: "Edited recovered draft", base: "Программа a", cycle: "Pending cycle", members: 2, editing: 1, startDate: "", week2: 0 });
  assert.equal(digest(f.sourcePath), f.sha);
}));
