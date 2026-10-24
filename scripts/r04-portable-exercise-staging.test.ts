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
import { legacyReadStagedExerciseCatalogPlan, legacyLoadExerciseDraftIdsPlan } from "../apps/mobile/src/features/exercises/data/legacy-import/LegacyExerciseCatalogStagePlan.ts";
import { combineLegacyStageExtensions } from "../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import { runLegacyWritePlan, type LegacyExerciseCheckpoint } from "../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { openIsolatedSqliteConnection } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import type { LegacyExerciseReferenceSource } from "../apps/mobile/src/shared/migration/LegacyExerciseSources.ts";
import type { LegacyImportSourceSnapshots } from "../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
import { readAdmittedLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { readRehearsedExerciseCatalog } from "./r04/LegacyExerciseCatalogStage.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";

const scope = "portable-exercise-writer", date = "2026-10-02T12:00:00Z", importedAt = "2026-10-24T12:00:00Z";
const phases: readonly LegacyExerciseCheckpoint[] = ["after-exercise-ids", "after-exercise-registry", "after-exercise-overlay", "after-exercise-links", "after-exercise-receipt"];
const tables = ["r04_candidate_identity", "r04_candidate_ids", "workspaces", "clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt",
  "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_reviews", "r04_work_receipt", "r04_exercise_ids", "r04_exercise_registry", "exercise_overlay", "r04_exercise_links", "r04_exercise_receipt"];
const allocate = () => { let next = 0; return () => `11111111-1111-4111-8111-${String(++next).padStart(12, "0")}`; };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function refs(s: LegacyImportSourceSnapshots): LegacyExerciseReferenceSource {
  return { accountScope: s.clients.accountScope, clients: s.clients.rows, workouts: s.plans.tables.training_workouts, exercises: s.plans.tables.training_exercises, history: s.executions.tables.training_exercise_history };
}
const extension = (s: LegacyImportSourceSnapshots) => combineLegacyStageExtensions(legacyQuestionnaireStagingExtension(s.questionnaire), legacyClientWorkDataStagingExtension(), legacyExerciseCatalogStagingExtension(s.exerciseCatalog, refs(s)));
function inspect<Result>(path: string, run: (db: DatabaseSync) => Result): Result { const db = new DatabaseSync(path); try { return run(db); } finally { db.close(); } }
const records = (path: string) => inspect(path, (db) => tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]));
function empty(path: string) { inspect(path, (db) => {
  for (const table of tables.filter((name) => !["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name))) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
}); }
async function setup(dir: string) {
  const sourcePath = join(dir, "source.sqlite"), db = new DatabaseSync(sourcePath); seedLegacyBackupMetadata(db, scope);
  db.exec(`UPDATE clients SET name='Same name',profile_json='{"trainerNotes":"Original note","trainerTags":["Shared tag"]}';
    INSERT INTO clients SELECT 'b',workspace_id,name,created_at,updated_at,'2026-10-03T12:00:00Z',deleted_at,birthdate,height,gender,avatar_emoji,profile_json FROM clients WHERE id='a';
    INSERT INTO training_workouts(id,client_id,name,data_json) VALUES('w-a','a','Same workout','{}'),('w-b','b','Same workout','{}');`);
  db.exec(`CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));`);
  const schema = JSON.stringify({ version: 1, sections: [{ id: "custom", title: "Original section", icon: "", hidden: false,
    questions: [{ id: "custom-question", title: "Original question", type: "short_text", required: false, access: "trainer_only", options: [], hidden: false }] }] });
  for (const [id, version, status] of [["published", 1, "published"], ["draft", 2, "draft"]] as const) db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(id, "synthetic-workspace", version, status, schema, date, status === "published" ? date : null);
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run("synthetic-workspace", "draft", "published", date);
  db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run("a", "custom-question", '"Original custom answer"', 1, date, null);
  for (const [id, category, equipment, source, deleted] of [["custom-unknown", "Другое", "", "user", null], ["custom-known", "Грудь", "Штанга", "user", null], ["stock-known", "Спина", "Тренажёр", "stock", null], ["custom-deleted", "Ноги", "", "user", date]] as const) db.prepare("INSERT INTO exercise_catalog VALUES(?,?,?,?,?,?,?,?,?)").run(id, "Same exercise", category, equipment, '["Original alias"]', source, date, date, deleted);
  for (const [id, workout, catalog, deleted] of [["e-a", "w-a", "custom-unknown", null], ["e-b", "w-b", "custom-unknown", null], ["e-deleted", "w-a", "custom-deleted", date]] as const) db.prepare("INSERT INTO training_exercises(id,workout_id,name,template_exercise_id,data_json,deleted_at,note) VALUES(?,?,?,?,?,?,?)").run(id, workout, "Original instance name", catalog, JSON.stringify({ catalogId: catalog }), deleted, "Original program note");
  db.prepare("INSERT INTO training_exercise_history(id,client_id,exercise_key,data_json,deleted_at) VALUES(?,?,?,?,NULL)").run("h-a", "a", "catalog:custom-unknown", '{"exerciseId":"e-a","catalogId":"custom-unknown","reps":20.00000000000000001}');
  db.prepare("INSERT INTO training_exercise_history(id,client_id,exercise_key,data_json,deleted_at) VALUES(?,?,?,?,NULL)").run("h-stock", "a", "catalog:stock-known", "{}");
  updateLegacyManifestSize(db); db.close(); const sha = digest(sourcePath), input = nativeFactory(sourcePath);
  const { admission, snapshots } = await readAdmittedLegacyDomainSnapshots(input.open, statSync(sourcePath).size);
  assert.equal(input.handles.size, 0); assert.equal(digest(sourcePath), sha);
  const stagePath = join(dir, "stage.sqlite");
  return { dir, sourcePath, sha, snapshots, stagePath, native: nativeFactory(stagePath), context: { sourceSha256: sha, accountScope: admission.accountScope, sourceWorkspaceId: admission.sourceWorkspaceId!, targetWorkspaceId: "local-trainer" } };
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-exercise-stage-"));
  try { await run(await setup(dir)); }
  finally { const absolute = resolve(dir); assert.equal(dirname(absolute), resolve(tmpdir())); assert.ok(basename(absolute).startsWith("athlete-r04-exercise-stage-")); rmSync(absolute, { recursive: true, force: true }); }
}

test("admitted catalog/reference rows reach async registry staging with the same host IDs, rows, receipts and domain read model", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocate());
  assert.deepEqual(result.extensionResult![2], { exerciseRows: 4, exerciseLinkRows: 5, unspecifiedCategoryRows: 2, unspecifiedEquipmentRows: 2, archivedExerciseRows: 1, finalizable: false });
  const hostPath = join(f.dir, "host.sqlite"); inspect(f.sourcePath, (source) => inspect(hostPath, (target) => {
    const catalog = readLegacyExerciseCatalogInSnapshot(source, scope), sourceRefs = readLegacyExerciseReferencesInSnapshot(source, scope, catalog);
    const ledger = prepareCandidateIdentityLedger(target, f.context, { clientIdentityRehearsal: { createdAt: importedAt, profiles: true, questionnaires: true, workData: true, exercises: true } });
    ledger.stageClientExerciseCatalog(projectLegacyClientCards(f.snapshots.clients, projectLegacyClientIdentities(f.snapshots.clients)), projectLegacyQuestionnaire(f.snapshots.questionnaire!), catalog, sourceRefs, allocate());
  }));
  assert.deepEqual(records(f.stagePath), records(hostPath));
  const db = await openIsolatedSqliteConnection(f.native.open);
  try {
    const ids = await runLegacyWritePlan(db, legacyLoadExerciseDraftIdsPlan(scope));
    assert.equal(ids.size, 4); assert.equal(new Set(ids.values()).size, 4);
    const catalog = await runLegacyWritePlan(db, legacyReadStagedExerciseCatalogPlan(f.context.targetWorkspaceId, true));
    assert.deepEqual(catalog, inspect(hostPath, (host) => readRehearsedExerciseCatalog(host, f.context.targetWorkspaceId, true)));
    assert.equal(catalog.filter((row) => row.definition.bodyPart === null).length, 2); assert.equal(catalog.filter((row) => row.definition.equipmentUnspecified).length, 2);
    assert.ok(catalog.every((row) => row.definition.trackingProfile === "LOAD_REPS"));
    assert.equal((await runLegacyWritePlan(db, legacyReadStagedExerciseCatalogPlan(f.context.targetWorkspaceId))).length, 3);
  } finally { await db.close(); }
  inspect(f.stagePath, (target) => {
    assert.equal(target.prepare("SELECT count(DISTINCT target_exercise_id) AS n FROM r04_exercise_links WHERE source_row_id IN ('e-a','e-b')").get()!.n, 1);
    assert.equal(target.prepare("SELECT count(DISTINCT target_client_id) AS n FROM r04_exercise_links WHERE source_row_id IN ('e-a','e-b')").get()!.n, 2);
    assert.ok(String(target.prepare("SELECT source_json FROM r04_exercise_links WHERE source_row_id='h-a'").get()!.source_json).includes("20.00000000000000001"));
    assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
  });
  assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("every awaited exercise checkpoint rolls back clients/Q/WorkData/registry IDs; reopen retry/replay allocate nothing", async () => {
  for (const phase of [...phases, "before-commit"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocate(), async (at) => { if (at === phase) { await Promise.resolve(); throw new Error("PRIVATE interruption"); } }), /WRITE_FAILED/u); empty(f.stagePath);
    await stage.stageClients(f.snapshots.clients, allocate()); const before = records(f.stagePath);
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    await reopened.stageClients({ ...f.snapshots.clients, rows: [...f.snapshots.clients.rows].reverse() }, () => assert.fail("replay allocated"));
    assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0);
  });
});

test("exercise commit acknowledgement loss replays without duplicating registry definitions, links or IDs", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); let failed = false;
  f.native.state.after = (call) => { if (!failed && call.kind === "exec" && call.sql === "COMMIT") { failed = true; throw new Error("PRIVATE lost commit acknowledgement"); } };
  await assert.rejects(stage.stageClients(f.snapshots.clients, allocate()), /WRITE_FAILED/u); const before = records(f.stagePath); f.native.state.after = undefined;
  const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
  await reopened.stageClients(f.snapshots.clients, () => assert.fail("committed ID allocated")); assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0);
}));

test("catalog and reference raw capture prevents caller changes after building an extension from changing staged values", () => fixture(async (f) => {
  const snapshot = structuredClone(f.snapshots), owner = extension(snapshot);
  Object.assign(snapshot.exerciseCatalog.rows[0]!, { name: "Changed catalog" }); Object.assign(snapshot.plans.tables.training_exercises![0]!, { template_exercise_id: "stock-known" });
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owner); await stage.stageClients(f.snapshots.clients, allocate());
  inspect(f.stagePath, (db) => { assert.equal(db.prepare("SELECT count(*) AS n FROM r04_exercise_registry WHERE name='Changed catalog'").get()!.n, 0); });
}));

test("conflicting catalog IDs and foreign-client instances block all owners instead of borrowing same-name definitions", async () => {
  for (const kind of ["conflict", "foreign", "bad-catalog", "collision"] as const) await fixture(async (f) => {
    const snapshot = structuredClone(f.snapshots);
    if (kind === "conflict") Object.assign(snapshot.plans.tables.training_exercises![0]!, { data_json: '{"catalogId":"stock-known"}' });
    if (kind === "foreign") Object.assign(snapshot.executions.tables.training_exercise_history![0]!, { client_id: "b" });
    if (kind === "bad-catalog") Object.assign(snapshot.exerciseCatalog.rows[0]!, { aliases_json: "{broken" });
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(snapshot)); let inCatalog = false; const next = allocate();
    await assert.rejects(stage.stageClients(f.snapshots.clients, () => inCatalog ? "99999999-9999-4999-8999-999999999999" : next(), (at) => { if (kind === "collision" && at === "after-work-data") inCatalog = true; }), /R04_ID_LEDGER_EXERCISE_/u);
    empty(f.stagePath); assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("ownership alias collisions and duplicate physical workouts reject before any file is opened", () => fixture(async (f) => {
  const source = refs(f.snapshots);
  for (const bad of [{ ...source, exercises: source.exercises!.map((row) => ({ ...row, client_id: "shadowed" })) }, { ...source, history: source.history!.map((row) => ({ ...row, owner_client_id: "shadowed" })) }]) {
    assert.throws(() => legacyExerciseCatalogStagingExtension(f.snapshots.exerciseCatalog, bad), /REFERENCE_RESERVED_COLUMN/u);
  }
  assert.throws(() => legacyExerciseCatalogStagingExtension(f.snapshots.exerciseCatalog, { ...source, workouts: [...source.workouts!, source.workouts![0]!] }), /REFERENCE_IDENTITY_INVALID/u);
  assert.equal(f.native.calls.length, 0);
}));

test("registry, links or receipt drift is detected without overwrite and without allocating replacement IDs", async () => {
  for (const sql of ["UPDATE r04_exercise_registry SET name='Drift'", "DELETE FROM r04_exercise_links", "UPDATE r04_exercise_receipt SET target_json='{}'"]) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocate());
    inspect(f.stagePath, (db) => db.exec(sql)); const before = records(f.stagePath);
    await assert.rejects(stage.stageClients(f.snapshots.clients, () => assert.fail("drift allocated")), /EXERCISE_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), before);
  });
});

test("exercise native schema/insert failure and incompatible owner mode do not leave partial earlier owners", async () => {
  for (const phase of ["schema", "write", "mode"] as const) await fixture(async (f) => {
    if (phase === "mode") {
      await prepareLegacyClientStaging(f.native.open, f.context, importedAt, combineLegacyStageExtensions(legacyQuestionnaireStagingExtension(null), legacyClientWorkDataStagingExtension())); const before = digest(f.stagePath);
      await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /FOREIGN_DATABASE/u); assert.equal(digest(f.stagePath), before); return;
    }
    if (phase === "write") await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    let failed = false; f.native.state.fail = (call) => { if (!failed && call.kind === "run" && (phase === "schema" ? call.sql.startsWith("CREATE TABLE r04_exercise_registry(") : call.sql.startsWith("INSERT INTO r04_exercise_registry("))) { failed = true; return true; } return false; };
    if (phase === "schema") { await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /WRITE_FAILED/u); inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_'").all(), [])); }
    else { const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await assert.rejects(stage.stageClients(f.snapshots.clients, allocate()), /WRITE_FAILED/u); empty(f.stagePath); }
    assert.equal(failed, true); assert.equal(f.native.handles.size, 0); f.native.state.fail = undefined;
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocate());
  });
});
