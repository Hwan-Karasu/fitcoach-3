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
import { readLegacyQuestionnaireInSnapshot } from "./r04/LegacyQuestionnaireSourceReader.ts";
import { trainerTagName } from "../apps/mobile/src/features/clients/domain/ClientWorkDataModel.ts";

const context = { sourceSha256: "b".repeat(64), accountScope: "synthetic-scope", sourceWorkspaceId: "synthetic-workspace", targetWorkspaceId: "local-trainer" };
const importedAt = "2026-02-05T10:00:00Z", sourceTime = "2026-02-04T10:00:00Z";
const options = { clientIdentityRehearsal: { createdAt: importedAt, profiles: true as const, questionnaires: true as const, workData: true as const } };
const profiles = [{ trainerNotes: "  Синтетическая заметка\nвторая строка  ", trainerTags: [" Утро ", "Онлайн", "утро"],
  healthCleared: false, diagnoses: "Исходный диагноз", injuries: "Старая травма", pain: "Исходная боль", hardMovements: "Сложное движение", unwantedLoad: "  Исходное пожелание нагрузки  " },
{ trainerNotes: "Отдельная архивная заметка", trainerTags: ["УТРО", "Вечер"], healthCleared: false }];
function allocate(start = 0) { let count = start; return () => `11111111-1111-4111-8111-${String(++count).padStart(12, "0")}`; }
function seed(db: DatabaseSync, input: readonly Record<string, unknown>[] = profiles) {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,
    birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT);
    CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));`);
  input.forEach((profile, i) => db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,?,NULL,'','','','',?)").run(String(i), context.sourceWorkspaceId,
    `Синтетический ${i}`, "2026-02-01T10:00:00Z", sourceTime, i === 1 ? sourceTime : null, JSON.stringify(profile)));
  const schema = { version: 1, sections: [{ id: "custom", title: "Своя анкета", icon: "", hidden: false, questions: [
    { id: "custom-text", type: "long_text", title: "Свой вопрос", required: false, access: "trainer_only", options: [], hidden: false }] }] };
  for (const revision of [1, 2]) db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(`revision-${revision}`, context.sourceWorkspaceId,
    revision, revision === 1 ? "published" : "draft", JSON.stringify(schema), sourceTime, revision === 1 ? sourceTime : null);
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run(context.sourceWorkspaceId, "revision-2", "revision-1", sourceTime);
  if (input.length > 0) db.prepare("INSERT INTO client_questionnaire_answers VALUES('0','custom-text',?,1,?,NULL)").run('"Исходный custom ответ"', sourceTime);
}
function read(db: DatabaseSync) {
  return { cards: readLegacyClientCardsInSnapshot(db, context.accountScope, readLegacyClientIdentityInSnapshot(db, context.accountScope)),
    questionnaire: readLegacyQuestionnaireInSnapshot(db, context.accountScope) };
}
function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void, input: readonly Record<string, unknown>[] = profiles) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source, input); run(source, target); } finally { source.close(); target.close(); }
}
const tables = ["clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt",
  "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_reviews", "r04_work_receipt"];

test("tag naming unifies only NFC/case/whitespace and retains distinct scripts, punctuation and ё", () => {
  assert.deepEqual(trainerTagName(" \tУТРО\n  зал  "), { name: "УТРО зал", key: "утро зал" });
  assert.equal(trainerTagName("И\u0306ога").key, trainerTagName("Йога").key);
  for (const [a, b] of [["Елка", "Ёлка"], ["VIP", "VIР"], ["Зал-1", "Зал—1"], ["Зал", "Зала"]]) assert.notEqual(trainerTagName(a!).key, trainerTagName(b!).key);
  for (const raw of ["", " \t\n ", "Ут\u0000ро", "Ут\u200Bро"]) assert.throws(() => trainerTagName(raw), /TAG_NAME_INVALID/u);
});
test("actual staged normalized notes, shared tags and assignments accompany client cards and custom answers", () => fixture((source, target) => {
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  const result = ledger.stageClientWorkData(input.cards, input.questionnaire, allocate());
  assert.equal(result.status, "work-data-rehearsal-staged"); assert.equal(result.finalizable, false);
  assert.equal(result.noteRows, 2); assert.equal(result.tagRows, 3); assert.equal(result.tagAssignmentRows, 4);
  assert.equal(result.safetyReviewRows, 5); assert.equal(result.activeSafetyRows, 0);
  const notes = target.prepare("SELECT * FROM r04_work_notes ORDER BY client_id").all();
  assert.equal(notes[0]!.body, profiles[0]!.trainerNotes); assert.equal(notes[0]!.created_at, importedAt); assert.equal(notes[0]!.updated_at, importedAt);
  assert.equal(notes[0]!.pinned, 0); assert.equal(notes[1]!.body, profiles[1]!.trainerNotes);
  assert.equal(target.prepare("SELECT lifecycle FROM clients WHERE id=?").get(notes[1]!.client_id!)?.lifecycle, "ARCHIVED");
  assert.equal(target.prepare("SELECT count(DISTINCT tag_id) AS n FROM r04_work_assignments WHERE tag_id IN (SELECT id FROM r04_work_tags WHERE normalized_name='утро')").get()?.n, 1);
  assert.equal(target.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE value_json=?").get('"Исходный custom ответ"')?.n, 1);
  assert.equal(target.prepare("SELECT count(*) AS n FROM questionnaire_versions").get()?.n, 2);
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));
test("health and unwantedLoad become exact pending review sources without active limitations or auto tags", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientWorkData(input.cards, input.questionnaire, allocate());
  const rows = target.prepare("SELECT source_field,body,status,imported_at,source_client_updated_at FROM r04_work_reviews ORDER BY source_field").all();
  assert.deepEqual(rows.map((r) => r.source_field), ["diagnoses", "hardMovements", "injuries", "pain", "unwantedLoad"]);
  for (const row of rows) { assert.equal(row.status, "PENDING_REVIEW"); assert.equal(row.imported_at, importedAt); assert.equal(row.source_client_updated_at, sourceTime); }
  assert.equal(rows.at(-1)!.body, profiles[0]!.unwantedLoad);
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_work_tags WHERE name='Есть ограничения'").get()?.n, 0);
  assert.equal(target.prepare("SELECT value_json FROM questionnaire_answers WHERE field_id='sys:health.diagnoses'").get()?.value_json, '"Исходный диагноз"');
}));
test("raw tag variants, source order and unknown note time remain explicit in provenance", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientWorkData(input.cards, input.questionnaire, allocate());
  const receipt = JSON.parse(String(target.prepare("SELECT target_json FROM r04_work_receipt").get()?.target_json)) as {
    tagNamePolicy: string; provenance: { tags: { sourceLabel: string; tagId: string }[]; sourceClientUpdatedAt: string; noteTimeBasis: string }[] };
  assert.equal(receipt.tagNamePolicy, "NFC_WHITESPACE_RU_CASE_V1");
  assert.deepEqual(receipt.provenance[0]!.tags.map((t) => t.sourceLabel), profiles[0]!.trainerTags);
  assert.equal(receipt.provenance[0]!.tags[0]!.tagId, receipt.provenance[0]!.tags[2]!.tagId);
  assert.equal(receipt.provenance[0]!.sourceClientUpdatedAt, sourceTime);
  assert.equal(receipt.provenance[0]!.noteTimeBasis, "IMPORT_TIME_SOURCE_NOTE_TIME_UNKNOWN");
}));
test("positive legacy clearance plus populated intake imports both facts without inventing an ACTIVE restriction", () => fixture((source, target) => {
  source.prepare("UPDATE clients SET profile_json=? WHERE id='0'").run(JSON.stringify({ ...profiles[0], healthCleared: true }));
  const input = read(source), result = prepareCandidateIdentityLedger(target, context, options).stageClientWorkData(input.cards, input.questionnaire, allocate());
  assert.equal(result.activeSafetyRows, 0); assert.equal(result.safetyReviewRows, 5);
  assert.equal(target.prepare("SELECT value_json FROM questionnaire_answers WHERE field_id='sys:health.noContra' ORDER BY client_id").get()?.value_json, "true");
  assert.equal(target.prepare("SELECT value_json FROM questionnaire_answers WHERE field_id='sys:health.diagnoses'").get()?.value_json, '"Исходный диагноз"');
}));
test("work-data foreign keys reject cross-workspace notes and orphan tag assignments", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientWorkData(input.cards, input.questionnaire, allocate());
  assert.throws(() => target.exec("UPDATE r04_work_notes SET workspace_id='foreign'"), /FOREIGN KEY/u);
  assert.throws(() => target.exec("UPDATE r04_work_assignments SET tag_id='missing' WHERE rowid=(SELECT rowid FROM r04_work_assignments LIMIT 1)"), /FOREIGN KEY/u);
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));
test("empty profiles do not eagerly create notes, tags or reviews", () => fixture((source, target) => {
  const input = read(source); const result = prepareCandidateIdentityLedger(target, context, options).stageClientWorkData(input.cards, input.questionnaire, allocate());
  for (const key of ["noteRows", "tagRows", "tagAssignmentRows", "safetyReviewRows"] as const) assert.equal(result[key], 0);
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_work_ids").get()?.n, 0);
}, [{}, { trainerNotes: " \n ", trainerTags: [] }]));
test("failure at each work-data table boundary rolls back client/profile/Q, identities and every operational row", () => {
  for (const [phase, nth] of [["after-ids", 1], ["after-profile", 1], ["after-work-data", 1], ["after-work-data", 2], ["after-work-data", 3], ["after-work-data", 4], ["before-commit", 1]] as const) fixture((source, target) => {
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options); let seen = 0;
    assert.throws(() => ledger.stageClientWorkData(input.cards, input.questionnaire, allocate(), (stage) => {
      if (stage === phase && ++seen === nth) throw new Error("injected");
    }), /WRITE_FAILED/u);
    for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
    assert.equal(ledger.stageClientWorkData(input.cards, input.questionnaire, allocate()).noteRows, 2);
  });
});
test("invalid tag names block the full operation instead of inventing empty entities or dropping source labels", () => {
  for (const label of ["  ", "\u200B", "Тег\u0000"]) fixture((source, target) => {
    source.prepare("UPDATE clients SET profile_json=? WHERE id='1'").run(JSON.stringify({ trainerTags: [label] }));
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientWorkData(input.cards, input.questionnaire, allocate()), /WORK_DATA_TAG_INVALID/u);
    for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
  });
});
test("foreign clients cannot acquire notes/tags/reviews from a different workspace", () => fixture((source, target) => {
  source.exec("UPDATE clients SET workspace_id='foreign' WHERE id='1'"); const input = read(source);
  const ledger = prepareCandidateIdentityLedger(target, context, options);
  assert.throws(() => ledger.stageClientWorkData(input.cards, input.questionnaire, allocate()), /SCOPE_MISMATCH/u);
  for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
}));
test("raw input is snapshotted before caller callbacks, and stale derived candidates cannot replace the note", () => fixture((source, target) => {
  const input = read(source); Object.assign(input.cards[0]!.legacyProfile!, { trainerNotes: "wrong derived note" });
  prepareCandidateIdentityLedger(target, context, options).stageClientWorkData(input.cards, input.questionnaire, allocate(), (stage) => {
    if (stage === "after-ids") Object.assign(input.cards[0]!.raw, { profile_json: JSON.stringify({ trainerNotes: "late mutation" }) });
  });
  assert.equal(target.prepare("SELECT body FROM r04_work_notes ORDER BY client_id").get()?.body, profiles[0]!.trainerNotes);
}));
test("earlier questionnaire files keep their binding; work-data mode cannot be bypassed by profile-only calls", () => fixture((source, target) => {
  const earlier = { clientIdentityRehearsal: { createdAt: importedAt, profiles: true as const, questionnaires: true as const } };
  const input = read(source); prepareCandidateIdentityLedger(target, context, earlier).stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /FOREIGN_DATABASE/u);
  const empty = new DatabaseSync(":memory:");
  try {
    const ledger = prepareCandidateIdentityLedger(empty, context, options);
    assert.throws(() => ledger.stageClientQuestionnaires(input.cards, input.questionnaire, allocate()), /WORK_DATA_MODE_MISMATCH/u);
    assert.equal(empty.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
  } finally { empty.close(); }
}));
test("committed note/tag/assignment/review/identity drift is rejected without resetting edited data", () => {
  for (const sql of ["UPDATE r04_work_notes SET body='Edited note'", "UPDATE r04_work_tags SET name='Edited tag'",
    "DELETE FROM r04_work_assignments", "UPDATE r04_work_reviews SET body='Edited review'", "DELETE FROM r04_work_ids WHERE kind='NOTE'"]) fixture((source, target) => {
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    ledger.stageClientWorkData(input.cards, input.questionnaire, allocate()); target.exec(sql);
    const edited = JSON.stringify(tables.map((t) => target.prepare(`SELECT * FROM ${t}`).all()));
    assert.throws(() => ledger.stageClientWorkData(input.cards, input.questionnaire, allocate(100)), /PARITY_MISMATCH/u);
    assert.equal(JSON.stringify(tables.map((t) => target.prepare(`SELECT * FROM ${t}`).all())), edited);
  });
});
test("allocator collisions across clients and work-data entities never commit partial records", () => fixture((source, target) => {
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options); const next = allocate(); let calls = 0;
  assert.throws(() => ledger.stageClientWorkData(input.cards, input.questionnaire, () => ++calls <= 2 ? next() : "11111111-1111-4111-8111-000000000001"), /IDENTITY_COLLISION/u);
  for (const table of tables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
}));
test("read-only source is unchanged; file reopen/reordered retry preserves IDs, records and exact target bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-work-data-")), sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); source.close(); source = null;
    const sourceHash = hash(sourcePath); source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN");
    const input = read(source), exactContext = { ...context, sourceSha256: sourceHash };
    target = new DatabaseSync(targetPath); prepareCandidateIdentityLedger(target, exactContext, options).stageClientWorkData(input.cards, input.questionnaire, allocate()); target.close(); target = null;
    const targetHash = hash(targetPath); target = new DatabaseSync(targetPath);
    const ledger = prepareCandidateIdentityLedger(target, exactContext, options);
    assert.equal(ledger.stageClientWorkData([...input.cards].reverse(), input.questionnaire, () => { throw new Error("must reuse IDs"); }).insertedRows, 0);
    target.close(); target = null; assert.equal(hash(targetPath), targetHash);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), sourceHash);
  } finally { target?.close(); source?.close(); rmSync(dir, { recursive: true, force: true }); }
});
