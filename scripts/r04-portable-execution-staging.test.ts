import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacyLoadPlanMappingsPlan } from "../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStagePlan.ts";
import { legacyExecutionStagingExtension } from "../apps/mobile/src/features/training/execution/data/legacy-import/LegacyExecutionStaging.ts";
import { legacyLoadExecutionFactsPlan } from "../apps/mobile/src/features/training/execution/data/legacy-import/LegacyExecutionStagePlan.ts";
import { combineLegacyStageExtensions } from "../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import { runLegacyWritePlan, type LegacyExecutionCheckpoint } from "../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { openIsolatedSqliteConnection } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { addWorkoutLog, oldWorkoutLog } from "./support/legacy-execution-source.ts";
import { scope, importedAt, allocator, digest, owners, extension, inspect, records, empty, fixture } from "./support/legacy-training-staging.ts";

const phases: readonly LegacyExecutionCheckpoint[] = ["after-execution-ids", "after-execution-sessions", "after-execution-facts", "after-execution-segments", "after-execution-representations", "after-execution-contexts", "after-execution-receipt"];

test("admitted full training graph reaches asynchronous execution staging with host-identical rows, IDs and receipts", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator());
  assert.equal(result.extensionResult![1].performedFacts, 6); assert.equal(result.finalizable, false);
  const hostPath = join(f.dir, "host.sqlite"); inspect(f.sourcePath, (source) => inspect(hostPath, (target) => {
    const catalog = readLegacyExerciseCatalogInSnapshot(source, scope), refs = readLegacyExerciseReferencesInSnapshot(source, scope, catalog);
    const ledger = prepareCandidateIdentityLedger(target, f.context, { clientIdentityRehearsal: { createdAt: importedAt, profiles: true, questionnaires: true, workData: true, exercises: true, plans: true, templates: true, archives: true, executions: true } });
    ledger.stageClientExecutions(projectLegacyClientCards(f.snapshots.clients, projectLegacyClientIdentities(f.snapshots.clients)), projectLegacyQuestionnaire(f.snapshots.questionnaire!), catalog, refs, f.snapshots.plans, f.snapshots.executions, allocator());
  }));
  assert.deepEqual(records(f.stagePath), records(hostPath));
  const db = await openIsolatedSqliteConnection(f.native.open);
  try { const facts = await runLegacyWritePlan(db, legacyLoadExecutionFactsPlan()); assert.equal(facts.length, 6); }
  finally { await db.close(); }
  inspect(f.stagePath, (db) => {
    const fact = (id: string) => db.prepare("SELECT * FROM r04_execution_facts WHERE source_identity_key=?").get(JSON.stringify([scope, "a", "EXPLICIT", id]))!;
    const current = fact("set-a0"); assert.deepEqual([current.reps, current.load_grams, current.date_precision, current.actual_date, current.actual_timestamp], [20, 10000, "UNKNOWN", null, null]);
    const drop = fact("drop"); assert.deepEqual([drop.set_type, drop.effort_outcome, drop.rpe], ["DROP", "failure", 9]);
    assert.deepEqual(db.prepare("SELECT reps,load_grams FROM r04_execution_segments WHERE fact_id=? ORDER BY position").all(drop.id!).map((r) => [r.reps, r.load_grams]), [[20, 10000], [15, 8000]]);
    const draft = db.prepare("SELECT context_json FROM r04_execution_representations WHERE source_key=?").get(JSON.stringify([scope, "training_set_logs", "draft"]))!;
    const editable = (JSON.parse(draft.context_json as string) as { editable: { confirmed: boolean; values: { reps: number; loadGrams: null } } }).editable;
    assert.deepEqual([editable.confirmed, editable.values.reps, editable.values.loadGrams], [false, 5, null]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_execution_representations WHERE fact_id=?").get(fact("old-log:e-a0:0").id!)!.n, 2);
    const receipt = db.prepare("SELECT * FROM r04_execution_receipt").get()!;
    const target = JSON.parse(receipt.target_json as string) as { sourceSha256: string };
    assert.equal(target.sourceSha256, createHash("sha256").update(receipt.source_json as string).digest("hex"));
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });
  assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("every asynchronous execution boundary rolls back all owners and permits retry, reopen and reordered replay", async () => {
  for (const phase of [...phases, "before-commit"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator(), async (at) => { if (at === phase) { await Promise.resolve(); throw new Error("PRIVATE interrupted execution"); } }), /WRITE_FAILED/u); empty(f.stagePath);
    await stage.stageClients(f.snapshots.clients, allocator()); const before = records(f.stagePath);
    const source = structuredClone(f.snapshots); for (const store of [source.plans, source.executions]) for (const rows of Object.values(store.tables)) if (rows) (rows as unknown[]).reverse();
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(source)); await reopened.stageClients(source.clients, () => assert.fail("replay allocated"));
    assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("lost execution COMMIT acknowledgement or post-commit close failure cannot duplicate facts or contexts", async () => {
  for (const kind of ["commit", "close"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); let failed = false;
    f.native.state.after = (call) => { if (!failed && (kind === "commit" ? call.kind === "exec" && call.sql === "COMMIT" : call.kind === "close")) { failed = true; throw new Error("PRIVATE acknowledgement lost"); } };
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); assert.equal(failed, true); const before = records(f.stagePath); f.native.state.after = undefined;
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await reopened.stageClients(f.snapshots.clients, () => assert.fail("committed ID allocated"));
    assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0);
  });
});

test("execution raw capture resists caller mutation before awaits and from earlier-owner callbacks", () => fixture(async (f) => {
  const source = structuredClone(f.snapshots), owner = extension(source);
  Object.assign(source.executions.tables.training_session_sets![0]!, { weight: "999" });
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owner);
  await stage.stageClients(f.snapshots.clients, allocator(), (phase) => { if (phase === "after-plan-receipt") Object.assign(source.plans.tables.training_set_logs![0]!, { reps: "999" }); });
  inspect(f.stagePath, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM r04_execution_facts WHERE load_grams=999000 OR reps=999").get()!.n, 0));
}));

test("execution identity collisions, partial caches, history drift and differing plan sources cannot commit preceding owners", async () => {
  for (const kind of ["collision", "partial", "history", "plans", "scope"] as const) await fixture(async (f) => {
    const source = structuredClone(f.snapshots), input = structuredClone(f.snapshots);
    if (kind === "partial") Object.assign(input.executions.tables, { training_session_sets: null });
    if (kind === "history") Object.assign(input.executions.tables.training_exercise_history![0]!, { updated_at: "changed" });
    if (kind === "plans") Object.assign(input.plans.tables.training_set_logs![0]!, { reps: "99" });
    if (kind === "scope") Object.assign(input.executions, { accountScope: "foreign" });
    const owner = combineLegacyStageExtensions(owners(source), legacyExecutionStagingExtension(input.plans, input.executions, () => legacyLoadPlanMappingsPlan(true)));
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owner); const next = allocator(); let execution = false, collided = false;
    await assert.rejects(stage.stageClients(source.clients, () => { if (execution && !collided) { collided = true; return "11111111-1111-4111-8111-000000000001"; } return next(); },
      (phase) => { if (kind === "collision" && phase === "after-plan-receipt") execution = true; }), /R04_ID_LEDGER_EXECUTION_/u);
    empty(f.stagePath); assert.equal(f.native.handles.size, 0);
  });
});

test("execution mode requires every preceding owner and cannot claim a plan-only staging file", () => fixture(async (f) => {
  assert.throws(() => combineLegacyStageExtensions(legacyExecutionStagingExtension(f.snapshots.plans, f.snapshots.executions, () => legacyLoadPlanMappingsPlan(true))), /EXTENSION_ORDER_INVALID/u);
  await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owners(f.snapshots)); const before = digest(f.stagePath), callCount = f.native.calls.length;
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /FOREIGN_DATABASE/u); assert.equal(digest(f.stagePath), before);
  assert.equal(f.native.calls.slice(callCount).some((call) => call.sql === "PRAGMA journal_mode=WAL"), false);
}));

test("asynchronous execution reads and replay reject drift in every retained target and identity store", async () => {
  for (const sql of ["UPDATE r04_execution_facts SET reps=reps+1", "UPDATE r04_execution_segments SET load_grams=load_grams+1",
    "UPDATE r04_execution_representations SET context_json='{}'", "UPDATE r04_execution_contexts SET diary_json='{}'", "UPDATE r04_execution_sessions SET working_facts=working_facts+1",
    "UPDATE r04_execution_ids SET source_key=source_key||' '", "UPDATE r04_execution_receipt SET target_json='{}'", "UPDATE r04_execution_receipt SET source_json='{}'"]) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator()); inspect(f.stagePath, (db) => db.exec(sql)); const before = records(f.stagePath);
    const db = await openIsolatedSqliteConnection(f.native.open);
    try { await assert.rejects(runLegacyWritePlan(db, legacyLoadExecutionFactsPlan()), /EXECUTION_PARITY_MISMATCH/u); } finally { await db.close(); }
    await assert.rejects(stage.stageClients(f.snapshots.clients, () => assert.fail("drift allocated")), /EXECUTION_(?:PARITY_MISMATCH|IDENTITY_INVALID)/u); assert.deepEqual(records(f.stagePath), before);
  });
});

test("execution schema and native fact insertion failures rollback schema or every preceding owner and close handles", async () => {
  for (const kind of ["schema", "write"] as const) await fixture(async (f) => {
    if (kind === "write") await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    let failed = false; f.native.state.fail = (call) => { if (!failed && call.kind === "run" && (kind === "schema" ? call.sql.startsWith("CREATE TABLE r04_execution_facts(") : call.sql.startsWith("INSERT INTO r04_execution_facts("))) { failed = true; return true; } return false; };
    if (kind === "schema") { await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /WRITE_FAILED/u); inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_'").all(), [])); }
    else { const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); empty(f.stagePath); }
    assert.equal(failed, true); assert.equal(f.native.handles.size, 0); f.native.state.fail = undefined;
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator());
  });
});

test("asynchronous snapshots retain unsupported numeric JSON spelling without rounding it into a performed fact", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator());
  assert.equal(result.extensionResult![1].performedFacts, 6);
  inspect(f.stagePath, (db) => {
    const row = db.prepare("SELECT disposition,source_json,context_json FROM r04_execution_representations WHERE source_kind='SNAPSHOT' AND source_key LIKE '%precise%'").get()!;
    assert.equal(row.disposition, "UNCONFIRMED"); assert.ok((row.source_json as string).includes("2.5000000000000001"));
    const editable = (JSON.parse(row.context_json as string) as { editable: { values: { loadGrams: null }; issues: string[] } }).editable;
    assert.equal(editable.values.loadGrams, null); assert.ok(editable.issues.includes("BASE_INVALID_WEIGHT"));
  });
}, (db) => {
  addWorkoutLog(db, oldWorkoutLog(), "precise");
  const json = JSON.stringify(oldWorkoutLog()).replace('"weight":"10"', '"weight":2.5000000000000001');
  db.prepare("UPDATE training_workout_logs SET data_json=? WHERE id='precise'").run(json);
}));
