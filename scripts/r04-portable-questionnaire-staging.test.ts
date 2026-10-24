import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacyQuestionnaireStagingExtension } from "../apps/mobile/src/features/questionnaire/data/legacy-import/LegacyQuestionnaireStaging.ts";
import { readAdmittedLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";

const scope = "portable-questionnaire-writer", workspace = "synthetic-workspace", createdAt = "2026-10-24T12:00:00Z", date = "2026-10-01T12:00:00Z";
const uuids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const allocate = () => { const values = [...uuids]; return () => values.shift()!; };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const tables = ["r04_candidate_identity", "r04_candidate_ids", "workspaces", "clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt"];
function seed(db: DatabaseSync) {
  seedLegacyBackupMetadata(db, scope);
  db.exec(`UPDATE clients SET name='Same name',height='180,5',gender='Мужской',profile_json='{"goalsOther":"Original goal","healthCleared":false,"trainerNotes":"Original private note"}';
    INSERT INTO clients SELECT 'b',workspace_id,name,created_at,updated_at,'2026-10-03T12:00:00Z',deleted_at,birthdate,height,gender,avatar_emoji,profile_json FROM clients WHERE id='a';
    CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));
    CREATE TABLE questionnaire_change_sets(id TEXT PRIMARY KEY,workspace_id TEXT,changes_json TEXT);`);
  const q = (id: string, type: string, options: string[] = []) => ({ id, type, title: `Original ${id}`, required: false, access: "trainer_only", options, hidden: false });
  for (const [id, version, status] of [["published-1", 1, "published"], ["published-4", 4, "published"], ["draft-5", 5, "draft"]] as const) {
    const schema = { version: 1, sections: [{ id: "section", title: "Original section", icon: "", hidden: false, questions: [
      q("short", "short_text"), q("long", "long_text"), q("number", version === 1 ? "number" : "long_text"), q("date", "date"),
      q("choice", "single_choice", version === 1 ? ["А", "Б"] : ["Б", "В"]), q("multi", "multiple_choice", ["А", "Б"]), q("flag", "switch"),
      ...(version === 1 ? [q("removed", "short_text"), q("dead", "short_text"), q("null", "short_text")] : []),
    ] }] };
    db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(id, workspace, version, status, JSON.stringify(schema), date, status === "published" ? date : null);
  }
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run(workspace, "draft-5", "published-4", "2026-10-06T12:00:00Z");
  for (const [client, question, value, version, deleted] of [["a", "short", "  Original spaces  ", 1, null], ["a", "long", "Line 1\nLine 2", 1, null],
    ["a", "number", 0, 1, null], ["a", "date", "2026-01-10", 1, null], ["a", "choice", "А", 1, null], ["a", "multi", ["Б", "А"], 1, null],
    ["a", "flag", false, 1, null], ["a", "removed", "Original removed answer", 1, null], ["a", "dead", "Deleted answer", 1, date],
    ["a", "null", null, 1, null], ["b", "number", "New text", 4, null]] as const) db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run(client, question, JSON.stringify(value), version, date, deleted);
  db.prepare("INSERT INTO questionnaire_change_sets VALUES(?,?,?)").run("change", workspace, '{"raw":"Original change"}');
  updateLegacyManifestSize(db);
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-questionnaire-stage-"));
  try { await run(await setup(dir)); }
  finally {
    const absolute = resolve(dir); assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(basename(absolute).startsWith("athlete-r04-questionnaire-stage-")); rmSync(absolute, { recursive: true, force: true });
  }
}
async function setup(dir: string) {
  const sourcePath = join(dir, "source.sqlite"), db = new DatabaseSync(sourcePath); seed(db); db.close(); const sha = digest(sourcePath);
  const input = nativeFactory(sourcePath), { admission, snapshots } = await readAdmittedLegacyDomainSnapshots(input.open, statSync(sourcePath).size);
  assert.equal(input.handles.size, 0); assert.equal(digest(sourcePath), sha);
  const stagePath = join(dir, "stage.sqlite"), native = nativeFactory(stagePath);
  return { dir, sourcePath, sha, snapshots, stagePath, native, context: { sourceSha256: sha, accountScope: admission.accountScope, sourceWorkspaceId: admission.sourceWorkspaceId!, targetWorkspaceId: "local-trainer" } };
}
function inspect<Result>(path: string, run: (db: DatabaseSync) => Result): Result { const db = new DatabaseSync(path); try { return run(db); } finally { db.close(); } }
const records = (path: string) => inspect(path, (db) => tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]));
function empty(path: string) { inspect(path, (db) => {
  for (const table of ["clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt"]) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
}); }

test("admitted questionnaires stage asynchronously in the same client transaction with host-identical rows and receipts", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, legacyQuestionnaireStagingExtension(f.snapshots.questionnaire));
  const result = await stage.stageClients(f.snapshots.clients, allocate()); assert.equal(result.extensionResult!.profileRows, 2); assert.equal(result.finalizable, false);
  const hostPath = join(f.dir, "host.sqlite"); inspect(hostPath, (db) => {
    const ledger = prepareCandidateIdentityLedger(db, f.context, { clientIdentityRehearsal: { createdAt, profiles: true, questionnaires: true } });
    ledger.stageClientQuestionnaires(projectLegacyClientCards(f.snapshots.clients, projectLegacyClientIdentities(f.snapshots.clients)), projectLegacyQuestionnaire(f.snapshots.questionnaire!), allocate());
  });
  assert.deepEqual(records(f.stagePath), records(hostPath));
  inspect(f.stagePath, (db) => {
    assert.deepEqual(db.prepare("SELECT version,published_at FROM questionnaire_versions ORDER BY version").all().map((r) => [r.version, r.published_at]), [[1, date], [4, date], [5, createdAt]]);
    assert.equal(db.prepare("SELECT base_version FROM questionnaire_drafts").get()!.base_version, 5);
    assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE value_json='0'").get()!.n, 1);
    const oldField = db.prepare("SELECT field_id FROM questionnaire_answers WHERE value_json='0'").get()!.field_id;
    const changedField = db.prepare("SELECT field_id FROM questionnaire_answers WHERE value_json='\"New text\"'").get()!.field_id;
    assert.notEqual(oldField, changedField);
    assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE value_json='false'").get()!.n, 3);
    assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE value_json IN ('null','\"Deleted answer\"')").get()!.n, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() => db.exec("UPDATE questionnaire_versions SET schema_json='{}' WHERE version=1"));
  });
  assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("awaited questionnaire checkpoint failure rolls back clients, IDs, versions, answers and receipt; retry/reopen replay are stable", async () => {
  for (const phase of ["after-profile", "before-commit"] as const) await fixture(async (f) => {
    const extension = legacyQuestionnaireStagingExtension(f.snapshots.questionnaire), stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, extension);
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocate(), async (at) => { if (at === phase) { await Promise.resolve(); throw new Error("PRIVATE checkpoint failure"); } }), { message: "R04_ID_LEDGER_WRITE_FAILED" });
    empty(f.stagePath); assert.equal(f.native.handles.size, 0);
    await stage.stageClients(f.snapshots.clients, allocate()); const before = records(f.stagePath);
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, extension);
    await reopened.stageClients({ ...f.snapshots.clients, rows: [...f.snapshots.clients.rows].reverse() }, () => assert.fail("replay allocated"));
    assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("questionnaire COMMIT acknowledgement loss replays without duplicate publications, answers or IDs", () => fixture(async (f) => {
  const extension = legacyQuestionnaireStagingExtension(f.snapshots.questionnaire), stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, extension); let failed = false;
  f.native.state.after = (call) => { if (!failed && call.kind === "exec" && call.sql === "COMMIT") { failed = true; throw new Error("PRIVATE lost commit acknowledgement"); } };
  await assert.rejects(stage.stageClients(f.snapshots.clients, allocate()), /WRITE_FAILED/u); assert.equal(f.native.handles.size, 0);
  const before = records(f.stagePath); f.native.state.after = undefined;
  const reopened = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, extension);
  await reopened.stageClients(f.snapshots.clients, () => assert.fail("committed ID allocated")); assert.deepEqual(records(f.stagePath), before);
}));

test("questionnaire raw capture protects schema, answers and change history from caller mutation", () => fixture(async (f) => {
  const raw = structuredClone(f.snapshots.questionnaire!), extension = legacyQuestionnaireStagingExtension(raw);
  Object.assign(raw.answers[0]!, { value_json: '"Changed"' }); Object.assign(raw.revisions[0]!, { schema_json: "{broken" }); Object.assign(raw.changes![0]!, { changes_json: "Changed" });
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, extension); await stage.stageClients(f.snapshots.clients, allocate());
  inspect(f.stagePath, (db) => {
    const receipt = db.prepare("SELECT source_json FROM r04_profile_receipt").get()!.source_json as string;
    assert.equal(receipt.includes("Changed"), false); assert.equal(receipt.includes("Original change"), true);
    assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE value_json='0'").get()!.n, 1);
  });
}));

test("invalid pointers, revisions, owners, JSON and change history block the full client/questionnaire batch", async () => {
  for (const kind of ["pointer", "revision", "owner", "json", "change"] as const) await fixture(async (f) => {
    const raw = structuredClone(f.snapshots.questionnaire!);
    if (kind === "pointer") Object.assign(raw.templates[0]!, { published_revision_id: "missing" });
    if (kind === "revision") Object.assign(raw.revisions.find((r) => r.id === "published-4")!, { revision: 1 });
    if (kind === "owner") Object.assign(raw.answers[0]!, { client_id: "foreign" });
    if (kind === "json") Object.assign(raw.answers[0]!, { value_json: "{broken" });
    if (kind === "change") Object.assign(raw.changes![0]!, { workspace_id: "foreign" });
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, legacyQuestionnaireStagingExtension(raw));
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocate()), /R04_ID_LEDGER_QUESTIONNAIRE_/u); empty(f.stagePath);
    assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("profile-only and questionnaire modes keep distinct bindings; absent stores do not create historical publications", () => fixture(async (f) => {
  await prepareLegacyClientStaging(f.native.open, f.context, createdAt, legacyQuestionnaireStagingExtension()); const before = digest(f.stagePath);
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, createdAt, legacyQuestionnaireStagingExtension(null)), /CONTEXT_MISMATCH/u);
  assert.equal(digest(f.stagePath), before);
  const absentPath = join(f.dir, "absent.sqlite"), absentNative = nativeFactory(absentPath);
  const absent = await prepareLegacyClientStaging(absentNative.open, f.context, createdAt, legacyQuestionnaireStagingExtension(null)); await absent.stageClients(f.snapshots.clients, allocate());
  inspect(absentPath, (db) => { assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_versions").get()!.n, 1); });
}));

test("stored questionnaire drift is detected by parity and never overwritten on replay", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, legacyQuestionnaireStagingExtension(f.snapshots.questionnaire)); await stage.stageClients(f.snapshots.clients, allocate());
  inspect(f.stagePath, (db) => { db.exec("UPDATE questionnaire_answers SET value_json='true' WHERE field_id='sys:health.noContra'"); });
  const before = records(f.stagePath);
  await assert.rejects(stage.stageClients(f.snapshots.clients, () => assert.fail("drift allocated")), /PROFILE_PARITY_MISMATCH/u);
  assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0);
}));

test("questionnaire schema creation failure rolls back the whole initialization and can be retried", () => fixture(async (f) => {
  let failed = false;
  f.native.state.fail = (call) => { if (!failed && call.kind === "run" && call.sql.startsWith("CREATE TABLE questionnaire_answers ")) { failed = true; return true; } return false; };
  const extension = legacyQuestionnaireStagingExtension(f.snapshots.questionnaire);
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, createdAt, extension), /WRITE_FAILED/u);
  assert.equal(failed, true); assert.equal(f.native.handles.size, 0);
  inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_'").all(), []));
  f.native.state.fail = undefined;
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt, extension); await stage.stageClients(f.snapshots.clients, allocate());
}));
