import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stageLegacyInspectionCandidate } from "../apps/mobile/src/app/composition/stageLegacyInspectionCandidate.ts";
import { prepareLegacyInspectionCopy } from "../apps/mobile/src/features/legacy-import/data/LegacyInspectionCopy.ts";
import { readAdmittedLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { LegacySourceAdmissionError } from "../apps/mobile/src/features/legacy-import/domain/LegacyBackupInventory.ts";
import { allFields } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireRules.ts";
import type { QuestionnaireSchema } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireModel.ts";
import { legacyQuestionnaireId } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireProjection.ts";
import { admitLegacyBackup } from "./r02/LegacyBackupInspector.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";
import { createInspectionFiles } from "./support/legacy-inspection-files.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";
import { allocator, digest, inspect } from "./support/legacy-training-staging.ts";
import { runLegacyJobWorker } from "./support/legacy-job-worker.ts";

const scope = "workspace-synthetic", workspace = "source-workspace", operationId = "11111111-1111-4111-8111-111111111111";
const time = "2026-10-01T12:00:00Z", importedAt = "2026-10-25T12:00:00Z", referenceDay = "2026-10-25";
function questionnaire(db: DatabaseSync, rows = true, nocase = false) {
  const collation = nocase ? " COLLATE NOCASE" : "";
  db.exec(`CREATE TABLE questionnaire_templates(workspace_id TEXT${collation} PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT${collation},revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,
      PRIMARY KEY(client_id,question_id),FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE);`);
  if (!rows) return;
  const schema = (label: string) => JSON.stringify({ version: 1, sections: [{ id: "custom", title: "Original section", hidden: false,
    questions: [{ id: "q", title: label, type: "short_text", required: false, access: "trainer_only", options: [], hidden: false }] }] });
  for (const [id, revision, status, label] of [["published", 1, "published", "Published question"], ["draft", 2, "draft", "Unpublished question"]] as const) {
    db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(id, workspace, revision, status, schema(label), time, status === "published" ? time : null);
  }
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run(workspace, "draft", "published", time);
}
const tables = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all().map((r) => r.name as string);
const records = (path: string) => inspect(path, (db) => tables(db).map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
async function fixture(amend: (db: DatabaseSync) => void, run: (f: {
  source: string; sha: string; native: ReturnType<typeof nativeFactory>; files: ReturnType<typeof createInspectionFiles>;
  receipt: Awaited<ReturnType<typeof prepareLegacyInspectionCopy>>;
}) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-source-workspace-"));
  try {
    const source = join(dir, "source.atbackup"), db = new DatabaseSync(source);
    seedLegacyBackupMetadata(db, scope); db.exec("UPDATE clients SET workspace_id='source-workspace'");
    amend(db); updateLegacyManifestSize(db); db.close();
    const files = createInspectionFiles(source, join(dir, "inspection"));
    const receipt = await prepareLegacyInspectionCopy(files.files, operationId);
    await run({ source, sha: digest(source), files, receipt, native: nativeFactory(join(dir, "candidate.sqlite")) });
  } finally {
    const path = resolve(dir); assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith("athlete-r04-source-workspace-"));
    rmSync(path, { recursive: true, force: true });
  }
}
type Fixture = Parameters<Parameters<typeof fixture>[1]>[0];
const target = (f: Fixture) => join(dirname(f.source), "candidate.sqlite");
const stage = (f: Fixture, allocate = allocator(), checkpoint?: Parameters<typeof stageLegacyInspectionCandidate>[1]) => stageLegacyInspectionCandidate({
  inspection: f.files.files, receipt: f.receipt, openStaging: f.native.open, targetWorkspaceId: "local-trainer", importedAt, referenceDay, allocate,
}, checkpoint);
function unchanged(f: Fixture) {
  assert.equal(digest(f.source), f.sha); assert.equal(digest(f.files.path(operationId, "source.sqlite")), f.sha);
  assert.equal(f.native.handles.size, 0); assert.equal(f.files.handles.size, 0);
}
function rejectedBeforeCollection(f: Fixture) {
  assert.equal(f.native.calls.length, 0);
  assert.equal(f.files.queries.some((sql) => sql.startsWith('SELECT * FROM "')), false);
  unchanged(f);
}
function empty(f: Fixture) {
  inspect(target(f), (db) => {
    for (const name of tables(db).filter((name) => !["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name))) {
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name}`).get()!.n, 0, name);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok"); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  }); unchanged(f);
}
const noClients = (db: DatabaseSync) => db.exec("DELETE FROM clients");

test("zero-client questionnaire has an explicit admitted owner and retains publications, draft, raw source and custom exercises on replay", () => fixture((db) => {
  noClients(db); questionnaire(db);
  db.prepare("INSERT INTO exercise_catalog VALUES('custom','Original exercise','Другое','','[]','user',?,?,NULL)").run(time, time);
}, async (f) => {
  const strict = inspect(f.source, (db) => admitLegacyBackup(db, statSync(f.source).size)), result = await stage(f);
  assert.deepEqual(result.admission, strict); assert.equal(result.admission.sourceWorkspaceId, workspace);
  assert.equal(result.admission.inventory.clientRows, 0); assert.equal(result.candidate.sourceRows, 0);
  assert.equal(result.candidate.owners.profileAndQuestionnaire.profileRows, 0); assert.equal(result.candidate.owners.exercises.exerciseRows, 1);
  assert.equal(result.candidate.owners.executions.performedFacts, 0); assert.equal(result.finalizable, false);
  inspect(target(f), (db) => {
    assert.equal(db.prepare("SELECT count(*) AS n FROM clients").get()!.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
    assert.equal(db.prepare("SELECT source_key FROM r04_candidate_ids WHERE kind='WORKSPACE'").get()!.source_key, JSON.stringify([scope, workspace]));
    const versions = db.prepare("SELECT * FROM questionnaire_versions ORDER BY version").all(); assert.deepEqual(versions.map((r) => r.version), [1, 2]);
    assert.equal(versions[0]!.published_at, time); assert.equal(versions[1]!.published_at, importedAt);
    const id = legacyQuestionnaireId([scope, workspace, "question", "q"]), schema = JSON.parse(versions[0]!.schema_json as string) as QuestionnaireSchema;
    assert.equal(allFields(schema).find(({ field }) => field.id === id)!.field.label, "Published question");
    const draft = db.prepare("SELECT * FROM questionnaire_drafts").get()!, draftSchema = JSON.parse(draft.schema_json as string) as QuestionnaireSchema;
    assert.equal(draft.base_version, 2); assert.equal(allFields(draftSchema).find(({ field }) => field.id === id)!.field.label, "Unpublished question");
    assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_answers").get()!.n, 0);
    const raw = JSON.parse(db.prepare("SELECT source_json FROM r04_profile_receipt").get()!.source_json as string);
    assert.equal(raw.questionnaire.templates[0].workspace_id, workspace); assert.equal(raw.questionnaire.revisions.length, 2);
  });
  const before = records(target(f)); await stage(f, () => assert.fail("replay allocated")); assert.deepEqual(records(target(f)), before); unchanged(f);
}));

test("physically present empty questionnaire stores preserve their receipt without claiming historical publications or inventing an owner", async () => {
  for (const clients of [false, true]) for (const changes of [false, true]) await fixture((db) => {
    if (!clients) noClients(db);
    else db.exec("UPDATE clients SET profile_json='{\"goalsOther\":\"Original profile goal\"}'");
    questionnaire(db, false);
    if (changes) db.exec("CREATE TABLE questionnaire_change_sets(id TEXT PRIMARY KEY,client_id TEXT,changes_json TEXT)");
  }, async (f) => {
    const result = await stage(f); assert.equal(result.admission.sourceWorkspaceId, clients ? workspace : null);
    assert.equal(result.candidate.sourceRows, clients ? 1 : 0);
    inspect(target(f), (db) => {
      assert.deepEqual(db.prepare("SELECT version,published_at FROM questionnaire_versions").all().map((r) => ({ ...r })), [{ version: 1, published_at: importedAt }]);
      const row = db.prepare("SELECT * FROM r04_profile_receipt").get()!, raw = JSON.parse(row.source_json as string), saved = JSON.parse(row.target_json as string);
      assert.deepEqual(raw.questionnaire, { accountScope: scope, templates: [], revisions: [], answers: [], changes: changes ? [] : null });
      assert.deepEqual(saved.questionnaire.revisionMaps, []);
      const answers = db.prepare("SELECT value_json FROM questionnaire_answers").all().map((r) => r.value_json);
      if (clients) assert.ok(answers.includes(JSON.stringify("Original profile goal"))); else assert.deepEqual(answers, []);
    });
    const before = records(target(f)); await stage(f, () => assert.fail("empty-store replay allocated")); assert.deepEqual(records(target(f)), before); unchanged(f);
  });
});

test("questionnaire/client/template namespace conflicts reject before domain reads and target creation without exposing identities", async () => {
  const cases: readonly ((db: DatabaseSync) => void)[] = [
    (db) => db.exec("UPDATE questionnaire_revisions SET workspace_id='PRIVATE-other' WHERE status='draft'"),
    (db) => db.exec("UPDATE clients SET workspace_id='PRIVATE-other'"),
    (db) => db.exec("UPDATE questionnaire_templates SET workspace_id=NULL"),
    (db) => db.prepare("UPDATE questionnaire_revisions SET workspace_id=? WHERE status='draft'").run("\n\u00a0\ufeff"),
    (db) => db.exec("UPDATE questionnaire_templates SET workspace_id=CAST(x'6162' AS BLOB)"),
    (db) => db.exec("INSERT INTO training_programs(id,client_id,is_template,template_workspace_id) VALUES('template','a',1,'PRIVATE-other')"),
    (db) => db.exec("INSERT INTO training_programs(id,client_id,is_template,template_workspace_id) VALUES('template','a',1,NULL)"),
  ];
  for (const amend of cases) await fixture((db) => { questionnaire(db); amend(db); }, async (f) => {
    await assert.rejects(stage(f), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("WORKSPACE_AMBIGUOUS") && !JSON.stringify(error).includes("PRIVATE"));
    rejectedBeforeCollection(f);
  });
});

test("NOCASE tables cannot merge differently spelled questionnaire owners when there are no clients", () => fixture((db) => {
  noClients(db); questionnaire(db, true, true); db.exec("UPDATE questionnaire_revisions SET workspace_id='SOURCE-WORKSPACE' WHERE status='draft'");
}, async (f) => {
  await assert.rejects(stage(f), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("WORKSPACE_AMBIGUOUS"));
  rejectedBeforeCollection(f);
}));

test("missing physical questionnaire scope columns are rejected instead of guessed from other rows", () => fixture((db) => {
  noClients(db); questionnaire(db, false); db.exec("DROP TABLE questionnaire_templates; CREATE TABLE questionnaire_templates(draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT)");
}, async (f) => {
  await assert.rejects(stage(f), (error) => error instanceof LegacySourceAdmissionError && error.inventory.missingRequiredShape.includes("questionnaire_templates.workspace_id"));
  rejectedBeforeCollection(f);
}));

test("unrelated settings do not establish a source workspace", () => fixture((db) => {
  noClients(db); db.prepare("INSERT INTO app_settings VALUES('workspace','{\"workspace_id\":\"PRIVATE-guess\"}',?)").run(time);
}, async (f) => {
  const result = await stage(f); assert.equal(result.admission.sourceWorkspaceId, null); unchanged(f);
}));

test("orphan answers still fail FK admission and partial questionnaire history cannot turn into unused stores", async () => {
  await fixture((db) => {
    noClients(db); questionnaire(db); db.exec("PRAGMA foreign_keys=OFF; INSERT INTO client_questionnaire_answers VALUES('missing','q','\"Original answer\"',1,'2026-10-01T12:00:00Z',NULL)");
  }, async (f) => {
    await assert.rejects(stage(f), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("FOREIGN_KEYS_FAILED"));
    rejectedBeforeCollection(f);
  });
  await fixture((db) => { noClients(db); questionnaire(db); db.exec("DELETE FROM questionnaire_templates"); }, async (f) => {
    await assert.rejects(stage(f), /QUESTIONNAIRE_SCOPE_MISMATCH/u); empty(f);
  });
});

test("client-free questionnaire interruption rolls back every owner and permits stable retry; target drift is never overwritten", () => fixture((db) => {
  noClients(db); questionnaire(db);
}, async (f) => {
  await assert.rejects(stage(f, allocator(), (at) => { if (at === "before-commit") throw new Error("Synthetic interruption"); }), /WRITE_FAILED/u); empty(f);
  await stage(f); const before = records(target(f)); await stage(f, () => assert.fail("retry replay allocated")); assert.deepEqual(records(target(f)), before);
  inspect(target(f), (db) => db.exec("UPDATE questionnaire_drafts SET schema_json='{}'")); const damaged = readFileSync(target(f));
  await assert.rejects(stage(f, () => assert.fail("drift replay allocated")), /PROFILE_PARITY_MISMATCH/u); assert.deepEqual(readFileSync(target(f)), damaged); unchanged(f);
}));

test("each new namespace SELECT failure closes the snapshot, retains safe diagnostics and allows retry", () => fixture((db) => {
  noClients(db); questionnaire(db);
}, async (f) => {
  const native = nativeFactory(f.source), bytes = statSync(f.source).size;
  for (let failure = 0; failure < 3; failure++) {
    let seen = 0;
    native.state.fail = (call) => call.sql.startsWith("SELECT DISTINCT CASE") && seen++ === failure;
    await assert.rejects(readAdmittedLegacyDomainSnapshots(native.open, bytes), { message: "R04_SOURCE_READ_FAILED" });
    assert.equal(native.handles.size, 0); assert.equal(digest(f.source), f.sha);
  }
  native.state.fail = undefined; const result = await readAdmittedLegacyDomainSnapshots(native.open, bytes);
  assert.equal(result.admission.sourceWorkspaceId, workspace); assert.equal(native.handles.size, 0); unchanged(f);
}));

test("actual Expo candidate runtime can start and resume a zero-client questionnaire from its stored request", () => fixture((db) => {
  noClients(db); questionnaire(db);
}, async (f) => {
  const root = join(dirname(f.source), "runtime-documents"), started = await runLegacyJobWorker({ root, source: f.source, action: "start" });
  assert.equal(started.ok, true, started.code); assert.deepEqual(started.counts, [0, 0, 0, 0]); assert.equal(started.handles, 0);
  const job = started.jobs[0]!, candidate = join(root, "legacy-import-jobs", job.jobId, "candidate.sqlite"), before = records(candidate);
  inspect(candidate, (db) => { assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_versions").get()!.n, 2); assert.equal(db.prepare("SELECT count(*) AS n FROM clients").get()!.n, 0); });
  const resumed = await runLegacyJobWorker({ root, source: f.source, action: "resume", jobId: job.jobId, clock: "2050-01-01T12:00:00Z", forbidSource: true, forbidAllocation: true });
  assert.equal(resumed.ok, true, resumed.code); assert.equal(resumed.issued, 0); assert.equal(resumed.importedAt, job.importedAt);
  assert.deepEqual(records(candidate), before); assert.equal(resumed.handles, 0); unchanged(f);
}));
