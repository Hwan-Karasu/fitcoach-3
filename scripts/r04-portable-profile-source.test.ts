import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readAdmittedLegacyDomainSnapshots, readLegacyProfileSnapshots, type NativeLegacySourceDatabase } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyExerciseCatalog } from "../apps/mobile/src/features/exercises/domain/legacy-import/LegacyExerciseCatalogProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { legacyQuestionnaireId } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireProjection.ts";
import { projectLegacyClientProfile } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyClientProfileProjection.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyQuestionnaireInSnapshot } from "./r04/LegacyQuestionnaireSourceReader.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";

const scope = "portable-profile-source", workspace = "synthetic-workspace", date = "2026-10-01T12:00:00Z";
function seed(db: DatabaseSync) {
  seedLegacyBackupMetadata(db, scope);
  db.exec(`UPDATE clients SET name='Same name',height='180,5',gender='Мужской',profile_json='{"goalsOther":"Original goal","trainerNotes":"Private original note"}';
    INSERT INTO clients SELECT 'b',workspace_id,name,created_at,updated_at,'2026-10-02T12:00:00Z',NULL,birthdate,height,gender,avatar_emoji,profile_json FROM clients WHERE id='a';
    CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));
    CREATE TABLE questionnaire_change_sets(id TEXT PRIMARY KEY,workspace_id TEXT,changes_json TEXT);`);
  for (const id of ["x", "y"]) db.prepare("INSERT INTO exercise_catalog VALUES(?,?,?,?,?,?,?,?,?)").run(id, "Same exercise", id === "x" ? "Грудь" : "Unknown category", "", "[]", "user", date, date, id === "y" ? date : null);
  const schema = { version: 1, sections: [{ id: "custom-section", title: "Original section", icon: "", hidden: false,
    questions: [{ id: "question", type: "number", title: "Original question", required: false, access: "trainer_only", options: [], hidden: false }] }] };
  for (const [id, revision, status] of [["published", 1, "published"], ["draft", 2, "draft"]] as const) {
    db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(id, workspace, revision, status, JSON.stringify(schema), date, status === "published" ? date : null);
  }
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run(workspace, "draft", "published", date);
  db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run("a", "question", "0", 1, date, null);
  db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run("b", "question", "42", 1, date, date);
  db.prepare("INSERT INTO questionnaire_change_sets VALUES(?,?,?)").run("change", workspace, '{"original":true}');
  updateLegacyManifestSize(db);
}
function source() { const db = new DatabaseSync(":memory:"); seed(db); return db; }
function native(db: DatabaseSync, after?: (sql: string) => void) {
  let closed = false; const calls: string[] = [];
  const port: NativeLegacySourceDatabase = { getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
    calls.push(sql); const rows = db.prepare(sql).all(...bindings as SQLInputValue[]) as Row[]; after?.(sql); return rows;
  }, execAsync: async (sql) => { calls.push(sql); db.exec(sql); }, closeAsync: async () => { db.close(); closed = true; } };
  return { port, calls, closed: () => closed };
}

test("mobile profiles preserve owners, unknown raw fields, deleted answers, original revisions and custom exercise classification", async () => {
  const db = source(); db.exec('ALTER TABLE clients ADD COLUMN "extra""raw" BLOB');
  db.exec("INSERT INTO clients(id,workspace_id,name,created_at,updated_at,deleted_at,birthdate,height,gender,avatar_emoji,profile_json) SELECT 'c',workspace_id,name,created_at,updated_at,'2026-10-03T12:00:00Z',birthdate,height,gender,avatar_emoji,profile_json FROM clients WHERE id='a'");
  db.prepare('UPDATE clients SET "extra""raw"=? WHERE id=?').run(new Uint8Array([0, 255]), "a");
  db.exec("UPDATE questionnaire_change_sets SET changes_json='{\"n\":9007199254740993}'");
  const identities = readLegacyClientIdentityInSnapshot(db, scope), expected = {
    cards: readLegacyClientCardsInSnapshot(db, scope, identities), catalog: readLegacyExerciseCatalogInSnapshot(db, scope), questionnaire: readLegacyQuestionnaireInSnapshot(db, scope),
  }, f = native(db), actual = await readLegacyProfileSnapshots(async () => f.port, scope);
  assert.equal(f.closed(), true);
  assert.deepEqual(projectLegacyClientIdentities(actual.clients), identities);
  assert.deepEqual(projectLegacyClientCards(actual.clients, identities), expected.cards);
  assert.deepEqual(projectLegacyExerciseCatalog(actual.exerciseCatalog), expected.catalog);
  assert.deepEqual(projectLegacyQuestionnaire(actual.questionnaire!), expected.questionnaire);
  assert.equal(identities.length, 3); assert.deepEqual(identities.map((row) => row.lifecycleCandidate), ["ACTIVE", "ARCHIVED", "DELETED_SOURCE"]);
  assert.equal(actual.clients.rows[0]!.name, actual.clients.rows[1]!.name); assert.notEqual(identities[0]!.sourceIdentityKey, identities[1]!.sourceIdentityKey);
  assert.deepEqual(actual.clients.rows[0]!['extra"raw'], new Uint8Array([0, 255]));
  assert.deepEqual(expected.catalog.map((row) => [row.trackingProfile, row.bodyPart, row.equipment, row.lifecycle]), [["LOAD_REPS", "chest", null, "ACTIVE_SOURCE"], ["LOAD_REPS", null, null, "DELETED_SOURCE"]]);
  assert.equal(actual.questionnaire!.changes![0]!.changes_json, '{"n":9007199254740993}');
  assert.equal(actual.questionnaire!.answers[1]!.deleted_at, date); assert.equal(expected.questionnaire!.answers[0]!.projection!.value, 0);
});

test("absent questionnaires stay absent; partial stores, orphan change history and views are rejected", async () => {
  const absent = source(); absent.exec("DROP TABLE questionnaire_templates; DROP TABLE questionnaire_revisions; DROP TABLE client_questionnaire_answers; DROP TABLE questionnaire_change_sets");
  assert.equal((await readLegacyProfileSnapshots(async () => native(absent).port, scope)).questionnaire, null);
  const empty = source(); empty.exec("DELETE FROM questionnaire_templates; DELETE FROM questionnaire_revisions; DELETE FROM client_questionnaire_answers; DELETE FROM questionnaire_change_sets");
  const emptyResult = (await readLegacyProfileSnapshots(async () => native(empty).port, scope)).questionnaire!;
  assert.ok(emptyResult); assert.deepEqual([emptyResult.templates, emptyResult.revisions, emptyResult.answers, emptyResult.changes], [[], [], [], []]);
  for (const change of ["DROP TABLE questionnaire_revisions", "DROP TABLE questionnaire_templates; DROP TABLE questionnaire_revisions; DROP TABLE client_questionnaire_answers",
    "DROP TABLE questionnaire_change_sets; CREATE VIEW questionnaire_change_sets AS SELECT 'change' AS id"]) {
    const db = source(); db.exec(change); const f = native(db);
    await assert.rejects(readLegacyProfileSnapshots(async () => f.port, scope), /R04_QUESTIONNAIRE_(?:TABLES_INCOMPLETE|SHAPE_UNSUPPORTED)/u); assert.equal(f.closed(), true);
  }
});

test("missing profile columns and unsafe SQL revision integers cannot become partial or rounded profile sources", async () => {
  for (const change of ["ALTER TABLE clients DROP COLUMN height", "ALTER TABLE exercise_catalog DROP COLUMN aliases_json", "UPDATE questionnaire_revisions SET revision=9007199254740993"]) {
    const db = source(); db.exec(change); const f = native(db);
    await assert.rejects(readLegacyProfileSnapshots(async () => f.port, scope), /(?:SHAPE_UNSUPPORTED|SQL_NUMBER_UNREPRESENTABLE)/u);
    if (change.includes("900719")) assert.equal(f.calls.some((sql) => sql.startsWith('SELECT * FROM "questionnaire_revisions"')), false);
    assert.equal(f.closed(), true);
  }
});

test("profile row loss is detected for every owner before returning a snapshot", async () => {
  for (const table of ["clients", "exercise_catalog", "questionnaire_templates", "questionnaire_revisions", "client_questionnaire_answers", "questionnaire_change_sets"]) {
    const f = native(source()), port: NativeLegacySourceDatabase = { ...f.port, getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
      const rows = await f.port.getAllAsync<Row>(sql, ...bindings as (string | number | null)[]);
      return sql.startsWith(`SELECT * FROM "${table}"`) ? rows.slice(1) : rows;
    } };
    await assert.rejects(readLegacyProfileSnapshots(async () => port, scope), /(?:CARDINALITY|COVERAGE)_MISMATCH/u); assert.equal(f.closed(), true);
  }
});

test("clients, catalog and questionnaire share one pinned WAL snapshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-profile-source-")), path = join(dir, "inspection.db"), writer = new DatabaseSync(path);
  try {
    writer.exec("PRAGMA journal_mode=WAL"); seed(writer); let changed = false;
    const f = native(new DatabaseSync(path), (sql) => {
      if (!changed && sql === 'SELECT count(*) AS n FROM "clients"') {
        changed = true; writer.exec("BEGIN; UPDATE clients SET name='Changed'; UPDATE exercise_catalog SET name='Changed'; UPDATE client_questionnaire_answers SET value_json='99'; COMMIT");
      }
    });
    const actual = await readLegacyProfileSnapshots(async () => f.port, scope);
    assert.equal(changed, true); assert.equal(actual.clients.rows[0]!.name, "Same name"); assert.equal(actual.exerciseCatalog.rows[0]!.name, "Same exercise");
    assert.equal(actual.questionnaire!.answers[0]!.value_json, "0"); assert.equal(writer.prepare("SELECT value_json FROM client_questionnaire_answers WHERE client_id='a'").get()!.value_json, "99");
    assert.equal(f.closed(), true);
  } finally {
    writer.close(); const absolute = resolve(dir); assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(basename(absolute).startsWith("athlete-r04-profile-source-")); rmSync(absolute, { recursive: true, force: true });
  }
});

test("portable questionnaire hashes preserve old Node UTF8 IDs for escaped, Unicode and semantic epoch parts", () => {
  for (const parts of [[scope, workspace, "question", "q"], ["Кириллица", "🏋️", "e\u0301", "\ud800"], [scope, workspace, "option", "q", "А", "semantic-epoch", "2"], ["", "\n\"\\\u0000"]]) {
    assert.equal(legacyQuestionnaireId(parts), `legacy:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`);
  }
});

test("portable profile projections load and run without any Node modules", async () => {
  const f = native(source()), snapshots = await readLegacyProfileSnapshots(async () => f.port, scope);
  const worker = `import{parentPort,workerData}from'node:worker_threads';import{registerHooks}from'node:module';
    registerHooks({resolve(s,c,n){if(s.startsWith('node:'))throw Error('NODE_DEPENDENCY_FORBIDDEN');return n(s,c)}});
    const i=await import(workerData.urls[0]),c=await import(workerData.urls[1]),e=await import(workerData.urls[2]),q=await import(workerData.urls[3]),p=await import(workerData.urls[4]);
    const s=workerData.snapshots,cards=c.projectLegacyClientCards(s.clients,i.projectLegacyClientIdentities(s.clients));
    parentPort.postMessage({cards,profiles:cards.map(c=>p.projectLegacyClientProfile(c.legacyProfile)),catalog:e.projectLegacyExerciseCatalog(s.exerciseCatalog),questionnaire:q.projectLegacyQuestionnaire(s.questionnaire)});`;
  const actual = await new Promise<unknown>((resolveWorker, reject) => {
    let received = false;
    const task = new Worker(new URL(`data:text/javascript,${encodeURIComponent(worker)}`), { execArgv: ["--experimental-strip-types"], workerData: { snapshots,
      urls: ["clients/LegacyClientIdentity", "clients/LegacyClientCardProjection", "exercises/LegacyExerciseCatalogProjection", "questionnaire/LegacyQuestionnaireCandidates", "questionnaire/LegacyClientProfileProjection"].map((path) => { const [owner, name] = path.split("/"); return new URL(`../apps/mobile/src/features/${owner}/domain/legacy-import/${name}.ts`, import.meta.url).href; }) } });
    task.once("message", (value: unknown) => { received = true; resolveWorker(value); }); task.once("error", reject);
    task.once("exit", (code) => { if (code || !received) reject(new Error(`PORTABLE_PROFILE_WORKER_EXIT_${code}`)); });
  });
  const cards = projectLegacyClientCards(snapshots.clients, projectLegacyClientIdentities(snapshots.clients));
  assert.deepEqual(actual, { cards, profiles: cards.map((card) => projectLegacyClientProfile(card.legacyProfile!)), catalog: projectLegacyExerciseCatalog(snapshots.exerciseCatalog), questionnaire: projectLegacyQuestionnaire(snapshots.questionnaire!) });
});

test("admitted mobile profile sources stage atomically with original versions, zero answers, stable IDs and repeat recovery", async () => {
  const db = source(), bytes = updateLegacyManifestSize(db), f = native(db), { admission, snapshots } = await readAdmittedLegacyDomainSnapshots(async () => f.port, bytes);
  assert.equal(f.closed(), true); assert.equal(admission.accountScope, scope);
  const cards = projectLegacyClientCards(snapshots.clients, projectLegacyClientIdentities(snapshots.clients)), catalog = projectLegacyExerciseCatalog(snapshots.exerciseCatalog), questionnaire = projectLegacyQuestionnaire(snapshots.questionnaire!);
  const target = new DatabaseSync(":memory:");
  try {
    const ledger = prepareCandidateIdentityLedger(target, { sourceSha256: "e".repeat(64), accountScope: admission.accountScope, sourceWorkspaceId: admission.sourceWorkspaceId!, targetWorkspaceId: "local-trainer" }, {
      clientIdentityRehearsal: { createdAt: "2026-10-24T12:00:00Z", profiles: true, questionnaires: true, workData: true, exercises: true },
    });
    const tables = ["clients", "questionnaire_versions", "questionnaire_answers", "questionnaire_drafts", "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_reviews", "r04_work_receipt", "r04_exercise_ids", "r04_exercise_registry", "r04_exercise_links", "r04_exercise_receipt"];
    let next = 0; const allocate = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
    assert.throws(() => ledger.stageClientExerciseCatalog(cards, questionnaire, catalog, [], allocate, (phase) => { if (phase === "after-exercise-receipt") throw new Error("injected"); }), /WRITE_FAILED/u);
    for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
    assert.equal(ledger.stageClientExerciseCatalog(cards, questionnaire, catalog, [], allocate).exerciseRows, 2);
    assert.equal(target.prepare("SELECT count(*) AS n FROM clients").get()!.n, 2);
    const fieldId = questionnaire.answers[0]!.projection!.fieldId;
    assert.equal(target.prepare("SELECT value_json FROM questionnaire_answers WHERE field_id=?").get(fieldId)!.value_json, "0");
    const stored = () => tables.map((table) => [table, target.prepare(`SELECT * FROM ${table}`).all()]);
    const before = stored(); ledger.stageClientExerciseCatalog(cards, questionnaire, catalog, [], () => assert.fail("replay allocated a new ID"));
    assert.deepEqual(stored(), before); assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { target.close(); }
});
