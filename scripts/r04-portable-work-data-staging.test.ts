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
import { combineLegacyStageExtensions } from "../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import { readAdmittedLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import type { LegacyQuestionnaireSource } from "../apps/mobile/src/shared/migration/LegacyProfileSources.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";

const scope = "portable-work-data-writer", importedAt = "2026-10-24T12:00:00Z", sourceTime = "2026-10-02T12:00:00Z";
const profiles = [{ trainerNotes: "  Original private note\nsecond line  ", trainerTags: [" Утро ", "Онлайн", "утро", "И\u0306ога"], healthCleared: true,
  diagnoses: "Original diagnosis", injuries: "Old injury", pain: "Original pain", hardMovements: "Original movement", unwantedLoad: "  Original load request  " },
{ trainerNotes: "Archived client's separate note", trainerTags: ["УТРО", "Вечер", "Йога"], healthCleared: false }];
const allocate = () => { let next = 0; return () => `11111111-1111-4111-8111-${String(++next).padStart(12, "0")}`; };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const workTables = ["r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_reviews", "r04_work_receipt"];
const tables = ["r04_candidate_identity", "r04_candidate_ids", "workspaces", "clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt", ...workTables];
const extension = (source: LegacyQuestionnaireSource | null) => combineLegacyStageExtensions(legacyQuestionnaireStagingExtension(source), legacyClientWorkDataStagingExtension());
function inspect<Result>(path: string, run: (db: DatabaseSync) => Result): Result { const db = new DatabaseSync(path); try { return run(db); } finally { db.close(); } }
const records = (path: string) => inspect(path, (db) => tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]));
function empty(path: string) { inspect(path, (db) => {
  for (const table of tables.filter((name) => !["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name))) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
}); }
async function setup(dir: string) {
  const sourcePath = join(dir, "source.sqlite"), db = new DatabaseSync(sourcePath); seedLegacyBackupMetadata(db, scope);
  db.exec("INSERT INTO clients SELECT 'b',workspace_id,name,created_at,updated_at,'2026-10-03T12:00:00Z',deleted_at,birthdate,height,gender,avatar_emoji,profile_json FROM clients WHERE id='a'");
  for (const [index, id] of ["a", "b"].entries()) db.prepare("UPDATE clients SET name='Same name',profile_json=? WHERE id=?").run(JSON.stringify(profiles[index]), id);
  db.exec(`CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));`);
  const schema = JSON.stringify({ version: 1, sections: [{ id: "custom", title: "Original custom section", icon: "", hidden: false,
    questions: [{ id: "custom-question", title: "Original custom question", type: "short_text", required: false, access: "trainer_only", options: [], hidden: false }] }] });
  for (const [id, version, status] of [["published", 1, "published"], ["draft", 2, "draft"]] as const) db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(id, "synthetic-workspace", version, status, schema, sourceTime, status === "published" ? sourceTime : null);
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run("synthetic-workspace", "draft", "published", sourceTime);
  db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run("a", "custom-question", '"Original custom answer"', 1, sourceTime, null);
  updateLegacyManifestSize(db); db.close(); const sha = digest(sourcePath), input = nativeFactory(sourcePath);
  const { admission, snapshots } = await readAdmittedLegacyDomainSnapshots(input.open, statSync(sourcePath).size);
  assert.equal(input.handles.size, 0); assert.equal(digest(sourcePath), sha); assert.ok(snapshots.questionnaire);
  const stagePath = join(dir, "stage.sqlite");
  return { dir, sourcePath, sha, stagePath, native: nativeFactory(stagePath), source: snapshots.clients, questionnaire: snapshots.questionnaire,
    context: { sourceSha256: sha, accountScope: admission.accountScope, sourceWorkspaceId: admission.sourceWorkspaceId!, targetWorkspaceId: "local-trainer" } };
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-work-data-stage-"));
  try { await run(await setup(dir)); }
  finally { const absolute = resolve(dir); assert.equal(dirname(absolute), resolve(tmpdir())); assert.ok(basename(absolute).startsWith("athlete-r04-work-data-stage-")); rmSync(absolute, { recursive: true, force: true }); }
}

test("admitted clients/Q/WorkData async chain matches all host rows, IDs, receipts and unchanged source SHA", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire)), result = await stage.stageClients(f.source, allocate());
  assert.equal(result.finalizable, false); assert.deepEqual(result.extensionResult![1], { noteRows: 2, tagRows: 4, tagAssignmentRows: 6, safetyReviewRows: 5, activeSafetyRows: 0, finalizable: false });
  const hostPath = join(f.dir, "host.sqlite"); inspect(hostPath, (db) => {
    const ledger = prepareCandidateIdentityLedger(db, f.context, { clientIdentityRehearsal: { createdAt: importedAt, profiles: true, questionnaires: true, workData: true } });
    ledger.stageClientWorkData(projectLegacyClientCards(f.source, projectLegacyClientIdentities(f.source)), projectLegacyQuestionnaire(f.questionnaire!), allocate());
  });
  assert.deepEqual(records(f.stagePath), records(hostPath));
  inspect(f.stagePath, (db) => {
    assert.equal(db.prepare("SELECT body FROM r04_work_notes ORDER BY client_id").get()!.body, profiles[0]!.trainerNotes);
    assert.equal(db.prepare("SELECT created_at FROM r04_work_notes").get()!.created_at, importedAt);
    assert.deepEqual(db.prepare("SELECT status,source_client_updated_at FROM r04_work_reviews").all().map((r) => [r.status, r.source_client_updated_at]), Array.from({ length: 5 }, () => ["PENDING_REVIEW", sourceTime]));
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_work_tags WHERE normalized_name='утро'").get()!.n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_work_tags WHERE normalized_name='йога'").get()!.n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE field_id='sys:health.noContra' AND value_json='true'").get()!.n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE value_json='\"Original custom answer\"'").get()!.n, 1);
    const provenance = db.prepare("SELECT target_json FROM r04_work_receipt").get()!.target_json as string;
    assert.equal(provenance.includes("IMPORT_TIME_SOURCE_NOTE_TIME_UNKNOWN"), true);
    assert.equal(provenance.includes(" Утро "), true); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });
  assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("every async WorkData write boundary rolls back all earlier owners, then retry and reopen replay keep IDs", async () => {
  for (const failAt of [1, 2, 3, 4, 5]) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire)); let seen = 0;
    await assert.rejects(stage.stageClients(f.source, allocate(), async (phase) => {
      if ((phase === "after-work-data" || phase === "before-commit") && ++seen === failAt) { await Promise.resolve(); throw new Error("PRIVATE interrupted work data"); }
    }), { message: "R04_ID_LEDGER_WRITE_FAILED" });
    empty(f.stagePath); assert.equal(f.native.handles.size, 0);
    await stage.stageClients(f.source, allocate()); const before = records(f.stagePath);
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire));
    await reopened.stageClients({ ...f.source, rows: [...f.source.rows].reverse() }, () => assert.fail("replay allocated"));
    assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("WorkData commit acknowledgement loss does not duplicate notes, normalized tags, reviews or IDs", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire)); let failed = false;
  f.native.state.after = (call) => { if (!failed && call.kind === "exec" && call.sql === "COMMIT") { failed = true; throw new Error("PRIVATE commit acknowledgement lost"); } };
  await assert.rejects(stage.stageClients(f.source, allocate()), /WRITE_FAILED/u); assert.equal(f.native.handles.size, 0); const before = records(f.stagePath);
  f.native.state.after = undefined;
  const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire));
  await reopened.stageClients(f.source, () => assert.fail("committed ID allocated")); assert.deepEqual(records(f.stagePath), before);
}));

test("caller changes between questionnaire and WorkData phases cannot change the captured notes, tags or provenance", () => fixture(async (f) => {
  const source = structuredClone(f.source), stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire));
  await stage.stageClients(source, allocate(), (phase) => {
    if (phase === "after-profile") Object.assign(source.rows[0]!, { profile_json: JSON.stringify({ trainerNotes: "Changed after capture", trainerTags: ["Changed tag"] }) });
  });
  inspect(f.stagePath, (db) => {
    assert.equal(db.prepare("SELECT body FROM r04_work_notes ORDER BY client_id").get()!.body, profiles[0]!.trainerNotes);
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_work_tags WHERE name='Changed tag'").get()!.n, 0);
    assert.equal(String(db.prepare("SELECT source_json FROM r04_work_receipt").get()!.source_json).includes("Changed after capture"), false);
  });
}));

test("WorkData owner order and missing profile dependencies fail before opening a staging file", () => fixture(async (f) => {
  assert.throws(() => combineLegacyStageExtensions(legacyClientWorkDataStagingExtension(), legacyQuestionnaireStagingExtension(null)), /EXTENSION_ORDER_INVALID/u);
  assert.throws(() => combineLegacyStageExtensions(legacyQuestionnaireStagingExtension(null), legacyQuestionnaireStagingExtension(null)), /EXTENSION_ORDER_INVALID/u);
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, legacyClientWorkDataStagingExtension()), /CONTEXT_INVALID/u);
  assert.equal(f.native.calls.length, 0);
  await prepareLegacyClientStaging(f.native.open, f.context, importedAt, legacyQuestionnaireStagingExtension(null)); const before = digest(f.stagePath);
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire)), /FOREIGN_DATABASE/u); assert.equal(digest(f.stagePath), before);
}));

test("invalid source tag data and colliding WorkData IDs cannot commit clients or questionnaires", async () => {
  for (const kind of ["control", "type", "collision"] as const) await fixture(async (f) => {
    const source = structuredClone(f.source);
    if (kind !== "collision") Object.assign(source.rows[0]!, { profile_json: JSON.stringify({ ...profiles[0], trainerTags: kind === "control" ? ["Ут\u200Bро"] : "wrong type" }) });
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire)), next = allocate(); let allocations = 0;
    await assert.rejects(stage.stageClients(source, () => { allocations++; return kind === "collision" && allocations > 2 ? "11111111-1111-4111-8111-000000000001" : next(); }), /R04_ID_LEDGER_/u);
    empty(f.stagePath); assert.equal(f.native.handles.size, 0);
    await stage.stageClients(f.source, allocate()); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("target note, tag assignment, review or receipt drift is detected without overwriting retained data", async () => {
  for (const sql of ["UPDATE r04_work_notes SET body='Drift'", "DELETE FROM r04_work_assignments", "UPDATE r04_work_reviews SET body='Drift'", "UPDATE r04_work_receipt SET target_json='{}'"]) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire)); await stage.stageClients(f.source, allocate());
    inspect(f.stagePath, (db) => db.exec(sql)); const before = records(f.stagePath);
    await assert.rejects(stage.stageClients(f.source, () => assert.fail("drift allocated")), /WORK_DATA_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), before);
  });
});

test("WorkData native insert and initial schema failures close every handle and rollback all owners", async () => {
  for (const phase of ["schema", "write"] as const) await fixture(async (f) => {
    let failed = false;
    if (phase === "write") await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire));
    f.native.state.fail = (call) => {
      if (!failed && call.kind === "run" && (phase === "schema" ? call.sql.startsWith("CREATE TABLE r04_work_tags(") : call.sql.startsWith("INSERT INTO r04_work_reviews("))) { failed = true; return true; } return false;
    };
    if (phase === "schema") {
      await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire)), /WRITE_FAILED/u);
      inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_'").all(), []));
    } else {
      const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire));
      await assert.rejects(stage.stageClients(f.source, allocate()), { message: "R04_ID_LEDGER_WRITE_FAILED" }); empty(f.stagePath);
    }
    assert.equal(failed, true); assert.equal(f.native.handles.size, 0); f.native.state.fail = undefined;
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.questionnaire)); await stage.stageClients(f.source, allocate());
  });
});
