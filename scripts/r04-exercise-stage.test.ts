import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { readLegacyQuestionnaireInSnapshot } from "./r04/LegacyQuestionnaireSourceReader.ts";
import { readRehearsedExerciseCatalog } from "./r04/LegacyExerciseCatalogStage.ts";
import { filterCatalog, filterOptionCounts, matchesQuery, NO_FILTERS, validateCustom } from "../apps/mobile/src/features/exercises/domain/ExerciseRules.ts";
import { bodyPartLabel, exerciseEquipmentLabel } from "../apps/mobile/src/features/exercises/domain/ExerciseLabels.ts";

const context = { sourceSha256: "c".repeat(64), accountScope: "synthetic-scope", sourceWorkspaceId: "synthetic-workspace", targetWorkspaceId: "local-trainer" };
const options = { clientIdentityRehearsal: { createdAt: "2026-03-05T10:00:00Z", profiles: true as const, questionnaires: true as const, workData: true as const, exercises: true as const } };
const createdAt = "2026-03-01T10:00:00Z", updatedAt = "2026-03-02T10:00:00Z", deletedAt = "2026-03-03T10:00:00Z";
const aliases = [" Точный старый синоним ", "Синоним", "Синоним", "я".repeat(100)];
function allocate(start = 0) { let n = start; return () => `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}`; }
function seed(db: DatabaseSync) {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,
      birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT);
    CREATE TABLE exercise_catalog(id TEXT PRIMARY KEY,name TEXT,category TEXT,equipment TEXT,aliases_json TEXT,source TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_workouts(id TEXT PRIMARY KEY,client_id TEXT);
    CREATE TABLE training_exercises(id TEXT PRIMARY KEY,workout_id TEXT,name TEXT,template_exercise_id TEXT,data_json TEXT,deleted_at TEXT,note TEXT);
    CREATE TABLE training_exercise_history(id TEXT PRIMARY KEY,client_id TEXT,exercise_key TEXT,data_json TEXT,deleted_at TEXT,updated_at TEXT);`);
  for (const id of ["a", "b"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,?,NULL,'','','','',?)").run(id, context.sourceWorkspaceId,
    `Синтетический ${id}`, createdAt, updatedAt, id === "b" ? deletedAt : null,
    JSON.stringify({ trainerNotes: `Заметка ${id}`, trainerTags: ["Общий тег"], goalsOther: `Цель ${id}` }));
  for (const [id, category, equipment, source, deleted, name] of [
    ["custom-unknown", "Другое", "", "user", null, "Одинаковое название"],
    ["custom-known", "Грудь", "Штанга", "user", null, "Одинаковое название"],
    ["stock-known", "Спина", "Тренажёр", "stock", null, "Одинаковое название"],
    ["custom-deleted", "Ноги", "", "user", deletedAt, "Удалённое упражнение"],
    ["custom-long", "", "", "user", null, "Своё упражнение " + "я".repeat(100)],
  ] as const) db.prepare("INSERT INTO exercise_catalog VALUES(?,?,?,?,?,?,?,?,?)").run(id, name, category, equipment,
    JSON.stringify(id === "custom-unknown" ? aliases : []), source, createdAt, updatedAt, deleted);
  db.exec("INSERT INTO training_workouts VALUES('workout-a','a'),('workout-b','b')");
  for (const [id, workout, catalog, deleted] of [["instance-a", "workout-a", "custom-unknown", null], ["instance-b", "workout-b", "custom-unknown", null],
    ["instance-deleted", "workout-a", "custom-deleted", deletedAt]] as const) db.prepare("INSERT INTO training_exercises VALUES(?,?,?,?,?,?,?)").run(
    id, workout, "Снимок старого названия", catalog, JSON.stringify({ catalogId: catalog }), deleted, "Заметка программы");
  db.prepare("INSERT INTO training_exercise_history VALUES(?,?,?,?,?,?)").run("history-a", "a", "catalog:custom-unknown",
    '{"exerciseId":"instance-a","catalogId":"custom-unknown","name":"Историческое название"}', null, updatedAt);
  db.prepare("INSERT INTO training_exercise_history VALUES(?,?,?,?,?,?)").run("history-stock", "a", "catalog:stock-known", "{}", null, updatedAt);
}
function read(db: DatabaseSync) {
  const catalog = readLegacyExerciseCatalogInSnapshot(db, context.accountScope);
  return { cards: readLegacyClientCardsInSnapshot(db, context.accountScope, readLegacyClientIdentityInSnapshot(db, context.accountScope)), catalog,
    refs: readLegacyExerciseReferencesInSnapshot(db, context.accountScope, catalog) };
}
function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source); run(source, target); } finally { source.close(); target.close(); }
}
const tables = ["clients", "questionnaire_versions", "questionnaire_answers", "r04_profile_receipt", "r04_work_ids", "r04_work_notes", "r04_work_tags",
  "r04_work_assignments", "r04_work_reviews", "r04_work_receipt", "r04_exercise_ids", "r04_exercise_registry", "exercise_overlay", "r04_exercise_links", "r04_exercise_receipt"];

test("client/Q/work records and all legacy stock/custom definitions commit with exact stable source links", () => fixture((source, target) => {
  const input = read(source), result = prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  assert.equal(result.status, "exercise-registry-rehearsal-staged"); assert.equal(result.finalizable, false);
  assert.equal(result.exerciseRows, 5); assert.equal(result.exerciseLinkRows, 5); assert.equal(result.unspecifiedCategoryRows, 3);
  assert.equal(result.unspecifiedEquipmentRows, 3); assert.equal(result.archivedExerciseRows, 1); assert.equal(result.noteRows, 2);
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_work_tags").get()?.n, 1);
  const links = target.prepare("SELECT * FROM r04_exercise_links ORDER BY source_key").all();
  const same = links.filter((r) => r.source_row_id === "instance-a" || r.source_row_id === "instance-b" || r.source_row_id === "history-a");
  assert.equal(new Set(same.map((r) => r.target_exercise_id)).size, 1); assert.equal(new Set(same.map((r) => r.target_client_id)).size, 2);
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));
test("unknown metadata remains usable in the domain catalog without becoming full-body or bodyweight", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  const entries = readRehearsedExerciseCatalog(target, context.targetWorkspaceId), unknown = entries.find((e) => e.definition.source?.sourceId === "custom-unknown")!;
  assert.equal(unknown.definition.bodyPart, null); assert.equal(unknown.definition.equipment, null); assert.equal(unknown.definition.equipmentUnspecified, true);
  assert.equal(unknown.definition.trackingProfile, "LOAD_REPS"); assert.deepEqual(unknown.definition.primaryMuscles, []);
  assert.equal(bodyPartLabel(unknown.definition.bodyPart), "Группа мышц не указана");
  assert.equal(exerciseEquipmentLabel(unknown.definition), "Оборудование не указано");
  assert.equal(filterCatalog(entries, "", "MINE", NO_FILTERS).some((e) => e.definition.id === unknown.definition.id), true);
  assert.equal(matchesQuery(unknown, "старый синоним"), true);
  assert.equal(filterCatalog([unknown], "", "ALL", { ...NO_FILTERS, equipment: new Set(["none"]) }).length, 0);
  assert.equal(filterCatalog([unknown], "", "ALL", { ...NO_FILTERS, equipment: new Set([""]) }).length, 1);
  assert.equal(filterCatalog([unknown], "", "ALL", { ...NO_FILTERS, bodyParts: new Set(["full_body"]) }).length, 0);
  assert.equal(filterOptionCounts([unknown], "", "ALL", NO_FILTERS, "bodyParts").size, 0);
  assert.throws(() => validateCustom({ name: "Новое", bodyPart: null, equipment: null, trackingProfile: "LOAD_REPS" }), /CATEGORY_REQUIRED/u);
}));
test("custom questionnaire history and exercise mappings coexist in the same transaction and identity ledger", () => fixture((source, target) => {
  source.exec(`CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));`);
  const schema = JSON.stringify({ version: 1, sections: [{ id: "custom-section", title: "Свой раздел", icon: "", hidden: false,
    questions: [{ id: "custom-question", type: "long_text", title: "Свой вопрос", required: false, access: "trainer_only", options: [], hidden: false }] }] });
  for (const version of [1, 2]) source.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(`revision-${version}`, context.sourceWorkspaceId,
    version, version === 1 ? "published" : "draft", schema, createdAt, version === 1 ? updatedAt : null);
  source.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run(context.sourceWorkspaceId, "revision-2", "revision-1", updatedAt);
  source.prepare("INSERT INTO client_questionnaire_answers VALUES('a','custom-question',?,1,?,NULL)").run('"Совместно перенесённый ответ"', updatedAt);
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientExerciseCatalog(input.cards, readLegacyQuestionnaireInSnapshot(source, context.accountScope), input.catalog, input.refs, allocate());
  assert.equal(target.prepare("SELECT schema_version FROM questionnaire_answers WHERE value_json=?").get('"Совместно перенесённый ответ"')?.schema_version, 1);
  assert.equal(target.prepare("SELECT max(version) AS n FROM questionnaire_versions").get()?.n, 2);
  assert.equal(ledger.loadExerciseDraftIds().size, 5);
  const mapped = ledger.loadExerciseDraftIds().get(JSON.stringify([context.accountScope, "exercise_catalog", "custom-unknown"]));
  assert.equal(mapped, target.prepare("SELECT id FROM r04_exercise_registry WHERE source_catalog_id='custom-unknown'").get()?.id);
}));
test("same names stay separate identities; legacy stock is never silently mapped to RepDB or made custom", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  const entries = readRehearsedExerciseCatalog(target, context.targetWorkspaceId);
  const same = entries.filter((e) => e.definition.name === "Одинаковое название");
  assert.equal(same.length, 3); assert.equal(new Set(same.map((e) => e.definition.id)).size, 3);
  const stock = same.find((e) => e.definition.origin === "SYSTEM")!;
  assert.match(stock.definition.id, /^sys:legacy-v2:/u); assert.equal(stock.definition.source?.provider, "LEGACY_V2");
  assert.equal(stock.definition.source?.sourceId, "stock-known"); assert.equal(stock.definition.bodyPart, "back");
  assert.equal(stock.definition.equipment, "Тренажёр"); assert.equal(stock.definition.trackingProfile, "LOAD_REPS");
  assert.ok(same.filter((e) => e.definition.origin === "CUSTOM").every((e) => e.definition.id.startsWith("usr:")));
}));
test("deleted definitions and source row snapshots remain readable to history but never return to active picks", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  assert.equal(readRehearsedExerciseCatalog(target, context.targetWorkspaceId).length, 4);
  assert.equal(readRehearsedExerciseCatalog(target, context.targetWorkspaceId, true).length, 5);
  const deleted = target.prepare("SELECT * FROM r04_exercise_registry WHERE source_catalog_id='custom-deleted'").get()!;
  assert.equal(deleted.archived_at, deletedAt); assert.equal(deleted.body_part, null);
  const link = target.prepare("SELECT source_deleted_at,source_json FROM r04_exercise_links WHERE source_row_id='instance-deleted'").get()!;
  assert.equal(link.source_deleted_at, deletedAt); assert.equal((JSON.parse(String(link.source_json)) as { note: string }).note, "Заметка программы");
  assert.match(String(target.prepare("SELECT source_json FROM r04_exercise_links WHERE source_row_id='history-a'").get()?.source_json), /Историческое название/u);
}));
test("aliases, long names and exact source timestamps are retained without normalization loss", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  const entries = readRehearsedExerciseCatalog(target, context.targetWorkspaceId);
  assert.deepEqual(entries.find((e) => e.definition.source?.sourceId === "custom-unknown")!.overlay.aliases, aliases);
  assert.equal(entries.find((e) => e.definition.source?.sourceId === "custom-long")!.definition.name, "Своё упражнение " + "я".repeat(100));
  assert.ok(target.prepare("SELECT created_at,updated_at,revision FROM r04_exercise_registry").all().every((r) => r.created_at === createdAt && r.updated_at === updatedAt && r.revision === 1));
}));
test("a deleted legacy stock record keeps its system identity and history references without becoming an active RepDB pick", () => fixture((source, target) => {
  source.prepare("UPDATE exercise_catalog SET deleted_at=? WHERE id='stock-known'").run(deletedAt);
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  assert.equal(readRehearsedExerciseCatalog(target, context.targetWorkspaceId).some((e) => e.definition.source?.sourceId === "stock-known"), false);
  const old = readRehearsedExerciseCatalog(target, context.targetWorkspaceId, true).find((e) => e.definition.source?.sourceId === "stock-known")!;
  assert.equal(old.definition.origin, "SYSTEM"); assert.match(old.definition.id, /^sys:legacy-v2:/u);
  assert.equal(target.prepare("SELECT target_exercise_id FROM r04_exercise_links WHERE source_row_id='history-stock'").get()?.target_exercise_id, old.definition.id);
}));
test("all new identities/client/Q/work/catalog/link rows roll back at every exercise transaction checkpoint", () => {
  for (const phase of ["after-exercise-ids", "after-exercise-registry", "after-exercise-overlay", "after-exercise-links", "after-exercise-receipt", "before-commit"] as const) fixture((source, target) => {
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate(), (stage) => { if (stage === phase) throw new Error("injected"); }), /WRITE_FAILED/u);
    for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
    assert.equal(ledger.stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate()).exerciseRows, 5);
  });
});
test("unresolved/cross-client catalog references and malformed rows block the whole bundle without guessed matches", () => {
  for (const sql of ["UPDATE exercise_catalog SET aliases_json='{broken' WHERE id='custom-unknown'", "UPDATE exercise_catalog SET source='other' WHERE id='stock-known'",
    "UPDATE training_exercises SET template_exercise_id='stock-known' WHERE id='instance-a'", "UPDATE training_exercise_history SET client_id='b' WHERE id='history-a'",
    "UPDATE training_exercises SET workout_id='missing' WHERE id='instance-a'", "UPDATE training_exercises SET deleted_at='bad' WHERE id='instance-a'"]) fixture((source, target) => {
    source.exec(sql); const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate()), /EXERCISE_/u);
    for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
  });
});
test("owner scope is checked beyond an apparently valid derived reference", () => fixture((source, target) => {
  const input = read(source); Object.assign(input.catalog[0]!, { accountScope: "foreign" });
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate()), /EXERCISE_SCOPE_MISMATCH/u);
  for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
}));
test("stale candidate fields and caller callback mutation cannot replace admitted raw catalog data", () => fixture((source, target) => {
  const input = read(source); Object.assign(input.catalog.find((r) => r.sourceCatalogId === "custom-unknown")!, { name: "wrong derived", bodyPart: "chest", equipment: "Штанга" });
  prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate(), (stage) => {
    if (stage === "after-ids") Object.assign(input.catalog[0]!.raw, { name: "late mutation", aliases_json: "{broken" });
  });
  const saved = target.prepare("SELECT name,body_part,equipment FROM r04_exercise_registry WHERE source_catalog_id='custom-unknown'").get()!;
  assert.equal(saved.name, "Одинаковое название"); assert.equal(saved.body_part, null); assert.equal(saved.equipment, null);
}));
test("existing work-data files retain their schema; exercise mode requires the full catalog entry point", () => fixture((source, target) => {
  const input = read(source), earlier = { clientIdentityRehearsal: { createdAt: options.clientIdentityRehearsal.createdAt, profiles: true as const, questionnaires: true as const, workData: true as const } };
  prepareCandidateIdentityLedger(target, context, earlier).stageClientWorkData(input.cards, null, allocate());
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /FOREIGN_DATABASE/u);
  const empty = new DatabaseSync(":memory:");
  try { const ledger = prepareCandidateIdentityLedger(empty, context, options);
    assert.throws(() => ledger.stageClientWorkData(input.cards, null, allocate()), /EXERCISE_MODE_MISMATCH/u);
    assert.equal(empty.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
  } finally { empty.close(); }
}));
test("catalog/overlay/link/identity drift is rejected without overwriting any committed row", () => {
  for (const sql of ["UPDATE r04_exercise_registry SET name='Edited'", "UPDATE exercise_overlay SET favorite=1", "DELETE FROM r04_exercise_links",
    "UPDATE r04_exercise_ids SET source_payload_json='{}'", "DELETE FROM r04_exercise_ids WHERE source_key LIKE '%custom-unknown%'"]) fixture((source, target) => {
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    ledger.stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate()); target.exec(sql);
    const edited = JSON.stringify(tables.map((table) => target.prepare(`SELECT * FROM ${table}`).all()));
    assert.throws(() => ledger.stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate(100)), /MISMATCH/u);
    assert.equal(JSON.stringify(tables.map((table) => target.prepare(`SELECT * FROM ${table}`).all())), edited);
  });
});
test("new source metadata on retry is not silently used to rewrite the completed catalog", () => fixture((source, target) => {
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  source.exec("UPDATE exercise_catalog SET category='Грудь' WHERE id='custom-unknown'"); const changed = read(source);
  assert.throws(() => ledger.stageClientExerciseCatalog(changed.cards, null, changed.catalog, changed.refs), /IDENTITY_MISMATCH/u);
  assert.equal(target.prepare("SELECT body_part FROM r04_exercise_registry WHERE source_catalog_id='custom-unknown'").get()?.body_part, null);
}));
test("duplicate exercise allocations roll back the entire shared transaction", () => fixture((source, target) => {
  const input = read(source), next = allocate(); let count = 0;
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs,
    () => ++count <= 5 ? next() : "99999999-9999-4999-8999-999999999999"), /IDENTITY_COLLISION/u);
  for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
}));
test("reference foreign keys prevent cross-workspace client/catalog links", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
  assert.throws(() => target.exec("UPDATE r04_exercise_links SET workspace_id='foreign'"), /FOREIGN KEY/u);
  assert.throws(() => target.exec("UPDATE r04_exercise_links SET target_exercise_id='missing'"), /FOREIGN KEY/u);
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));
test("read-only source and reopened/reordered target are byte-identical on completed replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-exercises-")), sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); source.close(); source = null; const sourceHash = hash(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN");
    const input = read(source), exactContext = { ...context, sourceSha256: sourceHash };
    target = new DatabaseSync(targetPath); prepareCandidateIdentityLedger(target, exactContext, options).stageClientExerciseCatalog(input.cards, null, input.catalog, input.refs, allocate());
    target.close(); target = null; const targetHash = hash(targetPath); target = new DatabaseSync(targetPath);
    const result = prepareCandidateIdentityLedger(target, exactContext, options).stageClientExerciseCatalog([...input.cards].reverse(), null,
      [...input.catalog].reverse(), [...input.refs].reverse(), () => { throw new Error("must reuse IDs"); });
    assert.equal(result.insertedRows, 0); target.close(); target = null; assert.equal(hash(targetPath), targetHash);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), sourceHash);
  } finally { target?.close(); source?.close(); rmSync(dir, { recursive: true, force: true }); }
});
