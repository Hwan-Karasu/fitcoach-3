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

const actor = "PRIVATE-source-trainer", accountScope = `trainer:${actor}:source-workspace`, date = "2026-03-01T12:00:00.000Z";
function setScope(db: DatabaseSync, scope: string) {
  db.prepare("UPDATE account_database_binding SET scope_key=?").run(scope);
  const manifest = JSON.parse(db.prepare("SELECT json FROM athlete_backup_manifest").get()!.json as string) as object;
  db.prepare("UPDATE athlete_backup_manifest SET json=?").run(JSON.stringify({ ...manifest, accountScopeKey: scope }));
}
function seed(db: DatabaseSync) {
  setScope(db, accountScope);
  db.exec("ALTER TABLE training_program_view_state ADD COLUMN last_opened_at TEXT");
  db.exec("UPDATE training_programs SET book_id='b-book',settings_json=json_set(settings_json,'$.pageIndex',0) WHERE id='p-b'");
  for (const [id, book, index] of [["p-b2", "b-book", 1], ["p-other", "other-book", 0]] as const) {
    db.prepare("INSERT INTO training_programs(id,client_id,mode,name,cycle_type,settings_json,book_id,is_template,created_at,updated_at,deleted_at,template_workspace_id) VALUES(?,'b','periodized',?,'hypertrophy',?,?,0,?,?,NULL,NULL)")
      .run(id, id, JSON.stringify({ totalWeeks: 1, pageIndex: index }), book, date, date);
    db.prepare("INSERT INTO training_weeks VALUES(?,?,0,'base','Week','{}',NULL)").run(`week-${id}`, id);
  }
  for (const book of ["b-book", "other-book"]) db.prepare("INSERT INTO training_library_programs VALUES(?,'b',?,'periodized',?,NULL)").run(book, book, date);
  db.prepare("INSERT INTO training_workspaces VALUES('b','p-other','{}',?,NULL)").run(date);
  db.prepare("INSERT INTO training_program_view_state VALUES(?,'b','b-book','p-b2','{\"p-b2\":{\"weekIndex\":0}}',?)").run(actor, "2050-01-01T00:00:00Z");
  db.prepare("INSERT INTO training_program_view_state VALUES('OTHER-actor','b','b-book','p-b','{}',?)").run("2099-01-01T00:00:00Z");
  db.prepare("INSERT INTO training_library_preferences VALUES(?,'b','b-book')").run(actor);
}
const fixture = (run: Parameters<typeof nutritionFixture>[0], amend: (db: DatabaseSync) => void = () => undefined) => nutritionFixture(run, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }); seed(db); amend(db);
});
type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
const stage = (f: Fixture, checkpoint?: Parameters<typeof stageLegacyImportCandidate>[1]) => stageLegacyImportCandidate({ openStaging: f.native.open,
  context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() }, checkpoint);
const records = (file: string) => inspect(file, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name as string}`).all()]));
function alias(file: string, id: string) { return inspect(file, (db) => db.prepare("SELECT * FROM r04_plan_source WHERE source_table='training_programs' AND source_row_id=?").get(id)!); }
function empty(file: string) { inspect(file, (db) => {
  for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_'").all()) if (!["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name as string)) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name as string}`).get()!.n, 0, name as string);
}); }
function reports(file: string) { return inspect(file, (db) => JSON.parse(db.prepare("SELECT target_json FROM r04_plan_receipt").get()!.target_json as string)) as {
  viewSelections: string[]; viewSelectionProjectionVersion: number;
}; }

test("a bound trainer's saved page restores a noncurrent book without selecting a pin or borrowing another actor's newer choice", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.plans.restoredViewSelections, 1); assert.equal(result.owners.plans.viewSelectionReviewRows, 0);
  const selected = alias(f.stagePath, "p-b2"), current = alias(f.stagePath, "p-other");
  inspect(f.stagePath, (db) => {
    assert.equal(db.prepare("SELECT mesocycle_id FROM training_mesocycle_selection WHERE client_id=? AND program_id=?").get(selected.target_client_id!, selected.target_program_id!)!.mesocycle_id, selected.target_id);
    assert.equal(db.prepare("SELECT program_id FROM training_client_selection WHERE client_id=?").get(selected.target_client_id!)!.program_id, current.target_program_id);
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_execution_facts").get()!.n, 6);
  });
  const report = reports(f.stagePath); assert.equal(report.viewSelectionProjectionVersion, 1);
  assert.ok(report.viewSelections.some((r) => r.includes('"RESTORED_BOOK_PAGE"'))); assert.ok(report.viewSelections.some((r) => r.includes('"OTHER_ACTOR_RETAINED"')));
  assert.equal(result.owners.plans.deferredViewRows, 2); assert.equal(result.owners.plans.deferredPreferenceRows, 1);
  const before = records(f.stagePath), source = structuredClone(f.snapshots); (source.plans.tables.training_program_view_state as unknown[]).reverse();
  await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: () => assert.fail("view replay allocated") });
  assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("legacy, client-role and mismatched workspace scopes never infer the trainer from a sole view row", async () => {
  for (const scope of ["trainer:legacy", `client:${actor}:b`, `trainer:${actor}:OTHER-workspace`, "opaque-source-scope"]) await fixture(async (f) => {
    const result = await stage(f); assert.equal(result.owners.plans.restoredViewSelections, 0); assert.equal(result.owners.plans.viewSelectionReviewRows, 1);
    assert.ok(reports(f.stagePath).viewSelections.some((r) => r.includes("SOURCE_TRAINER_ACTOR_NOT_PROVEN")));
    assert.equal(digest(f.sourcePath), f.sha);
  }, (db) => { setScope(db, scope); db.exec("DELETE FROM training_program_view_state WHERE actor_id='OTHER-actor'"); });
});

test("duplicate view identities, foreign pages, wrong books, deleted pages and dangling clients remain review without assigning a different selection", async () => {
  for (const [kind, reason] of [["duplicate", "VIEW_IDENTITY_AMBIGUOUS"], ["foreign", "VIEW_PAGE_NOT_AVAILABLE_FOR_CLIENT"], ["book", "VIEW_LIBRARY_SCOPE_MISMATCH"],
    ["deleted", "VIEW_PAGE_NOT_AVAILABLE_FOR_CLIENT"], ["client", "VIEW_CLIENT_NOT_FOUND"]] as const) await fixture(async (f) => {
    const result = await stage(f); assert.equal(result.owners.plans.restoredViewSelections, 0);
    assert.ok(reports(f.stagePath).viewSelections.some((r) => r.includes(reason)), reason);
    const current = alias(f.stagePath, "p-other");
    assert.equal(inspect(f.stagePath, (db) => db.prepare("SELECT program_id FROM training_client_selection WHERE client_id=?").get(current.target_client_id!)!.program_id), current.target_program_id);
    assert.equal(digest(f.sourcePath), f.sha);
  }, (db) => {
    if (kind === "duplicate") db.prepare("INSERT INTO training_program_view_state SELECT * FROM training_program_view_state WHERE actor_id=?").run(actor);
    else if (kind === "foreign") db.prepare("UPDATE training_program_view_state SET selected_program_id='p-a' WHERE actor_id=?").run(actor);
    else if (kind === "book") db.prepare("UPDATE training_program_view_state SET library_id='other-book' WHERE actor_id=?").run(actor);
    else if (kind === "deleted") db.prepare("UPDATE training_programs SET deleted_at=? WHERE id='p-b2'").run(date);
    else db.prepare("UPDATE training_program_view_state SET client_id='missing-client' WHERE actor_id=?").run(actor);
  });
});

test("an active-page conflict is explicit and never overwritten by the per-book view or its timestamp", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.plans.restoredViewSelections, 0); assert.equal(result.owners.plans.viewSelectionReviewRows, 1);
  const active = alias(f.stagePath, "p-b");
  assert.equal(inspect(f.stagePath, (db) => db.prepare("SELECT mesocycle_id FROM training_mesocycle_selection WHERE client_id=? AND program_id=?").get(active.target_client_id!, active.target_program_id!)!.mesocycle_id), active.target_id);
  assert.ok(reports(f.stagePath).viewSelections.some((r) => r.includes("VIEW_AND_ACTIVE_PAGE_CONFLICT")));
}, (db) => db.exec("UPDATE training_workspaces SET active_program_id='p-b' WHERE client_id='b'")));

test("an archived book retains its selected page without returning to the active library or becoming current", () => fixture(async (f) => {
  const result = await stage(f); assert.equal(result.owners.plans.restoredViewSelections, 1);
  const page = alias(f.stagePath, "p-b2"), current = alias(f.stagePath, "p-other");
  inspect(f.stagePath, (db) => {
    assert.equal(db.prepare("SELECT archived_at FROM training_program_members WHERE client_id=? AND program_id=?").get(page.target_client_id!, page.target_program_id!)!.archived_at, date);
    assert.equal(db.prepare("SELECT program_id FROM training_client_selection WHERE client_id=?").get(page.target_client_id!)!.program_id, current.target_program_id);
  });
}, (db) => db.prepare("UPDATE training_library_programs SET archived_at=? WHERE id='b-book'").run(date)));

test("a Simple page and an empty saved selection never activate a book or manufacture a mesocycle", () => fixture(async (f) => {
  assert.equal((await stage(f)).owners.plans.restoredViewSelections, 1);
  const all = reports(f.stagePath).viewSelections;
  assert.ok(all.some((r) => r.includes('"SIMPLE_PAGE_REPRESENTED"'))); assert.ok(all.some((r) => r.includes('"NO_SELECTED_PAGE"')));
  const simple = alias(f.stagePath, "p-a");
  inspect(f.stagePath, (db) => {
    assert.equal(db.prepare("SELECT 1 FROM training_client_selection WHERE client_id=?").get(simple.target_client_id!), undefined);
    assert.equal(db.prepare("SELECT 1 FROM training_mesocycle_selection WHERE client_id=?").get(simple.target_client_id!), undefined);
  });
}, (db) => {
  db.prepare("INSERT INTO training_program_view_state VALUES(?,'a','p-a','p-a','{}',NULL)").run(actor);
  db.prepare("INSERT INTO training_program_view_state VALUES(?,'b','other-book',NULL,'{}',NULL)").run(actor);
}));

test("plan row/receipt checkpoints roll back restored selections with every owner and a retry reuses native IDs", async () => {
  for (const phase of ["after-plan-rows", "after-plan-receipt", "after-execution-receipt", "before-commit", "write"] as const) await fixture(async (f) => {
    let writes = 0;
    if (phase === "write") f.native.state.fail = (c) => c.kind === "run" && c.sql.startsWith("INSERT INTO training_mesocycle_selection") && ++writes === 2;
    await assert.rejects(stage(f, (at) => { if (at === phase) throw Error("PRIVATE callback"); }), /WRITE_FAILED/u); empty(f.stagePath);
    if (phase === "write") assert.equal(writes, 2); f.native.state.fail = undefined;
    assert.equal((await stage(f)).owners.plans.restoredViewSelections, 1); const before = records(f.stagePath);
    await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: () => assert.fail("retry allocated") });
    assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
  });
});

test("view source capture, target corruption and the immutable mode cannot rewrite a staged candidate", () => fixture(async (f) => {
  const source = structuredClone(f.snapshots), pending = stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() });
  Object.assign(source.plans.tables.training_program_view_state![0]!, { selected_program_id: "p-b" }); await pending;
  const before = records(f.stagePath);
  await assert.rejects(stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() }), /PLANS_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), before);
  const a = alias(f.stagePath, "p-b"), b = alias(f.stagePath, "p-b2");
  inspect(f.stagePath, (db) => db.prepare("UPDATE training_mesocycle_selection SET mesocycle_id=? WHERE client_id=? AND program_id=?").run(a.target_id!, b.target_client_id!, b.target_program_id!));
  const damaged = records(f.stagePath); await assert.rejects(stage(f), /PLANS_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), damaged);
  inspect(f.stagePath, (db) => {
    const old = JSON.parse(db.prepare("SELECT context_json FROM r04_candidate_identity").get()!.context_json as string) as unknown[];
    assert.ok(old.includes("TRAINING_VIEW_SELECTIONS_REHEARSAL_V1"));
    db.prepare("UPDATE r04_candidate_identity SET context_json=?").run(JSON.stringify(old.filter((v) => v !== "TRAINING_VIEW_SELECTIONS_REHEARSAL_V1")));
  });
  const bytes = digest(f.stagePath), calls = f.native.calls.length; await assert.rejects(stage(f), /CONTEXT_MISMATCH/u);
  assert.equal(digest(f.stagePath), bytes); assert.equal(f.native.calls.slice(calls).some((c) => /^PRAGMA\s+journal_mode\s*=/iu.test(c.sql)), false);
  assert.ok(f.native.calls.slice(0, calls).some((c) => /^PRAGMA\s+journal_mode\s*=/iu.test(c.sql))); assert.equal(f.native.handles.size, 0);
}));

test("actual Expo runtime restart and host process termination preserve the page selection without re-reading the selected source", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), killed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start", killAt: "before-commit" });
  assert.equal(killed.terminated, true); const jobId = killed.jobs[0]!.jobId, file = join(root, "legacy-import-jobs", jobId, "candidate.sqlite"); empty(file);
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true });
  assert.equal(resumed.ok, true, resumed.code); const page = alias(file, "p-b2");
  assert.equal(inspect(file, (db) => db.prepare("SELECT mesocycle_id FROM training_mesocycle_selection WHERE client_id=? AND program_id=?").get(page.target_client_id!, page.target_program_id!)!.mesocycle_id), page.target_id);
  const before = records(file), replay = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true, forbidAllocation: true });
  assert.equal(replay.ok, true, replay.code); assert.equal(replay.handles, 0); assert.deepEqual(records(file), before); assert.equal(digest(f.sourcePath), f.sha);
}));

test("normal 3.x storage reads and changes a restored nonfirst mesocycle after backup with the importer unavailable", () => fixture(async (f) => {
  await stage(f); const page = alias(f.stagePath, "p-b2"), first = alias(f.stagePath, "p-b"), current = alias(f.stagePath, "p-other");
  const file = join(f.dir, "normal.sqlite"), db = new DatabaseSync(file);
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
    const before=await repo.getPeriodizedPlan(d.client,d.program),library=await repo.getLibrary(d.client);await repo.selectMesocycle(d.client,d.program,d.first);
    const after=await repo.getPeriodizedPlan(d.client,d.program),unchanged=await repo.getLibrary(d.client);await repo.close();db.close();
    parentPort.postMessage({blocked,before:before.selectedMesocycleId,first:before.mesocycles[0].id,after:after.selectedMesocycleId,current:library.selectedProgramId,unchanged:unchanged.selectedProgramId});`;
  const observed = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), { execArgv: ["--experimental-strip-types"], workerData: {
      file: restored, client: page.target_client_id, program: page.target_program_id, first: first.target_id,
      probe: new URL("../apps/mobile/src/features/training/plans/domain/legacy-import/LegacyPlanViewSelections.ts", import.meta.url).href,
      reader: new URL("../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts", import.meta.url).href,
      shared: new URL("../apps/mobile/src/shared/db/SharedSqliteDatabase.ts", import.meta.url).href, port: new URL("./support/node-sqlite-port.ts", import.meta.url).href } });
    let result: unknown; worker.once("message", (v: unknown) => { result = v; }); worker.once("error", reject);
    worker.once("exit", (code) => code || result === undefined ? reject(new Error(`VIEW_READER_EXIT_${code}`)) : resolve(result));
  });
  assert.deepEqual(observed, { blocked: true, before: page.target_id, first: first.target_id, after: first.target_id, current: current.target_program_id, unchanged: current.target_program_id });
  assert.notEqual(page.target_id, first.target_id); assert.equal(digest(f.sourcePath), f.sha);
}));
