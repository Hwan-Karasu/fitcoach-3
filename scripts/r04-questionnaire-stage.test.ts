import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyQuestionnaireInSnapshot } from "./r04/LegacyQuestionnaireSourceReader.ts";
import { projectLegacyQuestionnaireSchema } from "./r04/LegacyQuestionnaireProjection.ts";
import { allFields, isFieldVisible, validateSchema } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireRules.ts";
import type { QuestionnaireSchema } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireModel.ts";

const context = { sourceSha256: "a".repeat(64), accountScope: "synthetic-scope", sourceWorkspaceId: "synthetic-workspace", targetWorkspaceId: "local-trainer" };
const options = { clientIdentityRehearsal: { createdAt: "2026-01-05T10:00:00Z", profiles: true as const, questionnaires: true as const } };
const firstId = "11111111-1111-4111-8111-111111111111", secondId = "22222222-2222-4222-8222-222222222222";
const date = (day: number) => `2026-01-0${day}T10:00:00Z`;
const q = (id: string, type: string, opts: string[] = []) => ({ id, type, title: `Синтетический ${id}`, required: false, access: "trainer_only", options: opts, hidden: false });
function schema(version: 1 | 2 | 3): { version: 1; sections: { id: string; legacySectionId?: string; title: string; icon: string; hidden: boolean; questions: ReturnType<typeof q>[] }[] } {
  return { version: 1, sections: [
    { id: "builtin:goals", legacySectionId: "goals", title: version === 1 ? "Старые цели" : "Переименованные цели", icon: "", hidden: false,
      questions: [q("choice", "single_choice", version === 1 ? ["А", "Б"] : version === 2 ? ["Б", "В"] : ["Б", "В", "Г"]),
        q("flip", version === 1 ? "number" : "long_text"), q("flag", "switch"), q("text", version === 1 ? "short_text" : "long_text"),
        ...(version === 1 ? [q("removed", "long_text"), q("dead", "short_text"), q("null", "short_text")] : []),
        ...(version === 3 ? [q("unpublished", "short_text")] : [])] },
    { id: "empty", title: "Пустой пользовательский раздел", icon: "", hidden: false, questions: [] },
    { id: "builtin:health", legacySectionId: "health", title: "Скрытые сведения", icon: "", hidden: true, questions: [] },
  ] };
}
function seed(db: DatabaseSync) {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,
    birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT);
    CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));
    CREATE TABLE questionnaire_change_sets(id TEXT PRIMARY KEY,workspace_id TEXT,changes_json TEXT);`);
  for (const id of ["a", "b"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,?,NULL,?,?,?,?,?)").run(id, context.sourceWorkspaceId,
    `Синтетический ${id}`, date(1), date(4), id === "b" ? date(4) : null, "2000-01-01", "180,5", "Мужской", "🏋️",
    JSON.stringify({ goalsOther: `Профиль ${id}`, healthCleared: false, ...(id === "a" ? { trainerNotes: "Приватная старая заметка" } : {}) }));
  for (const revision of [1, 2, 3] as const) db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(
    `revision-${revision}`, context.sourceWorkspaceId, revision, revision === 3 ? "draft" : "published", JSON.stringify(schema(revision)), date(revision), revision === 3 ? null : date(revision));
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run(context.sourceWorkspaceId, "revision-3", "revision-2", date(4));
  for (const [client, question, value, revision, deleted] of [["a", "choice", "А", 1, null], ["a", "flip", 0, 1, null], ["a", "removed", "  Старый текст  ", 1, null],
    ["a", "dead", "Удалённый ответ", 1, date(4)], ["a", "null", null, 1, null], ["b", "choice", "Б", 2, null], ["b", "flip", "Новый текст", 2, null],
    ["b", "flag", false, 2, null], ["b", "text", "  Без изменения пробелов  ", 2, null]] as const) {
    db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run(client, question, JSON.stringify(value), revision, date(revision), deleted);
  }
  db.prepare("INSERT INTO questionnaire_change_sets VALUES(?,?,?)").run("change-1", context.sourceWorkspaceId, '{"source":"synthetic audit"}');
}
function read(db: DatabaseSync) {
  return { cards: readLegacyClientCardsInSnapshot(db, context.accountScope, readLegacyClientIdentityInSnapshot(db, context.accountScope)),
    questionnaire: readLegacyQuestionnaireInSnapshot(db, context.accountScope)! };
}
function allocate() { const ids = [firstId, secondId]; return () => ids.shift()!; }
function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source); run(source, target); } finally { source.close(); target.close(); }
}
function published(db: DatabaseSync, version: number) {
  return JSON.parse(String(db.prepare("SELECT schema_json FROM questionnaire_versions WHERE version=?").get(version)?.schema_json)) as QuestionnaireSchema;
}
const field = (schema: QuestionnaireSchema, id: string) => allFields(schema).find(({ field }) => field.id === id)?.field;
function original(question: string, version: 1 | 2 = 1) { return projectLegacyQuestionnaireSchema(context.accountScope, context.sourceWorkspaceId, schema(version)).fields.get(question)!; }

test("profiles, exact historical publications, migration publication and unpublished draft share one staged database", () => fixture((source, target) => {
  const input = read(source); const result = prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  assert.equal(result.status, "questionnaire-rehearsal-staged"); assert.equal(result.finalizable, false);
  assert.deepEqual(target.prepare("SELECT version,published_at FROM questionnaire_versions ORDER BY version").all().map((r) => [r.version, r.published_at]), [[1, date(1)], [2, date(2)], [3, options.clientIdentityRehearsal.createdAt]]);
  assert.deepEqual(target.prepare("SELECT base_version,revision,updated_at FROM questionnaire_drafts").all().map((r) => [r.base_version, r.revision, r.updated_at]), [[3, 1, date(4)]]);
  const current = published(target, 3); const draft = JSON.parse(String(target.prepare("SELECT schema_json FROM questionnaire_drafts").get()?.schema_json)) as QuestionnaireSchema;
  assert.equal(allFields(current).some(({ field }) => field.label === "Синтетический unpublished"), false);
  assert.equal(allFields(draft).some(({ field }) => field.label === "Синтетический unpublished"), true);
  assert.equal(current.sections[0]!.id, "sys:goals"); assert.equal(current.sections[0]!.title, "Переименованные цели");
  assert.equal(current.sections.find((s) => s.id === "sys:health")!.hidden, true);
  assert.equal(current.sections.some((s) => s.title === "Пустой пользовательский раздел" && s.fields.length === 0), true);
  for (const version of [1, 2, 3]) assert.deepEqual(validateSchema(published(target, version)), []);
  assert.equal(target.prepare("SELECT schema_version FROM questionnaire_answers WHERE client_id=? AND field_id='sys:goals.other'").get(firstId)?.schema_version, 3);
  assert.equal(target.prepare("SELECT value_json FROM questionnaire_answers WHERE client_id=? AND field_id='sys:goals.other'").get(firstId)?.value_json, '"Профиль a"');
  assert.equal(target.prepare("PRAGMA foreign_key_check").all().length, 0);
}));
test("used removed option is retired only in migration view; historical versions are not rewritten", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  const id = original("choice").id;
  assert.deepEqual(field(published(target, 1), id)!.options.map((o) => o.label), ["А", "Б"]);
  assert.deepEqual(field(published(target, 2), id)!.options.map((o) => o.label), ["Б", "В"]);
  const current = field(published(target, 3), id)!;
  assert.equal(current.options.find((o) => o.label === "А")?.retired, true);
  const answer = target.prepare("SELECT value_json,schema_version,updated_at FROM questionnaire_answers WHERE client_id=? AND field_id=?").get(firstId, id)!;
  assert.equal(JSON.parse(String(answer.value_json)), current.options.find((o) => o.label === "А")!.id);
  assert.equal(answer.schema_version, 1); assert.equal(answer.updated_at, date(1));
}));
test("removed answered fields remain retired, while tombstones/null never resurrect as active answers", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  const current = published(target, 3), old = original("removed");
  assert.equal(field(current, old.id)?.retired, true); assert.equal(isFieldVisible(current, old.id, {}), false);
  assert.equal(target.prepare("SELECT value_json FROM questionnaire_answers WHERE field_id=?").get(old.id)?.value_json, '"  Старый текст  "');
  for (const id of [original("dead").id, original("null").id]) {
    assert.equal(target.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE field_id=?").get(id)?.n, 0); assert.equal(field(current, id), undefined);
  }
  const receipt = JSON.parse(String(target.prepare("SELECT target_json FROM r04_profile_receipt").get()?.target_json)) as { questionnaire: { answerMaps: { disposition: string }[]; sourceChanges: unknown[] } };
  assert.equal(receipt.questionnaire.answerMaps.filter((r) => r.disposition === "DELETED").length, 1);
  assert.equal(receipt.questionnaire.answerMaps.filter((r) => r.disposition === "NULL").length, 1); assert.equal(receipt.questionnaire.sourceChanges.length, 1);
}));
test("incompatible type epochs never reinterpret old numeric zero as new text or merge clients", () => fixture((source, target) => {
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  const rows = target.prepare("SELECT client_id,field_id,value_json,schema_version FROM questionnaire_answers WHERE field_id NOT LIKE 'sys:%'").all();
  const zero = rows.find((r) => r.client_id === firstId && r.value_json === "0")!;
  const text = rows.find((r) => r.client_id === secondId && r.value_json === '"Новый текст"')!;
  assert.notEqual(zero.field_id, text.field_id); assert.equal(zero.schema_version, 1); assert.equal(text.schema_version, 2);
  assert.equal(field(published(target, 3), String(zero.field_id))!.type, "NUMBER"); assert.equal(field(published(target, 3), String(zero.field_id))!.retired, true);
  assert.equal(field(published(target, 3), String(text.field_id))!.type, "LONG_TEXT");
  assert.ok(rows.some((r) => r.client_id === secondId && r.value_json === "false"));
  assert.equal(original("text", 1).id, original("text", 2).id);
}));
test("a draft changing back to an earlier type gets a new epoch and retains both answered past epochs", () => fixture((source, target) => {
  const changed = schema(3); changed.sections[0]!.questions.find((q) => q.id === "flip")!.type = "number";
  source.prepare("UPDATE questionnaire_revisions SET schema_json=? WHERE id='revision-3'").run(JSON.stringify(changed));
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  const draft = JSON.parse(String(target.prepare("SELECT schema_json FROM questionnaire_drafts").get()?.schema_json)) as QuestionnaireSchema;
  const flips = allFields(draft).map((r) => r.field).filter((f) => f.label === "Синтетический flip");
  assert.equal(flips.length, 3); assert.equal(new Set(flips.map((f) => f.id)).size, 3); assert.equal(flips.filter((f) => !f.retired).length, 1);
}));
test("all seven question types reach SQLite without stringifying zero/false or reordering selected choices", () => fixture((source, target) => {
  const old = schema(1); old.sections[0]!.questions.push(q("multi", "multiple_choice", ["Л", "П"]), q("date", "date"));
  source.prepare("UPDATE questionnaire_revisions SET schema_json=? WHERE id='revision-1'").run(JSON.stringify(old));
  for (const [question, value] of [["multi", ["П", "Л"]], ["date", "2026-01-01"], ["text", "Короткий ответ"]] as const) {
    source.prepare("INSERT INTO client_questionnaire_answers VALUES('a',?,?,1,?,NULL)").run(question, JSON.stringify(value), date(1));
  }
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  const projection = projectLegacyQuestionnaireSchema(context.accountScope, context.sourceWorkspaceId, old);
  const readValue = (id: string) => JSON.parse(String(target.prepare("SELECT value_json FROM questionnaire_answers WHERE client_id=? AND field_id=?").get(firstId, id)?.value_json)) as unknown;
  assert.deepEqual(readValue(projection.fields.get("multi")!.id), [projection.legacyOptionIds.get("multi")!.get("П"), projection.legacyOptionIds.get("multi")!.get("Л")]);
  assert.equal(readValue(projection.fields.get("date")!.id), "2026-01-01"); assert.equal(readValue(projection.fields.get("text")!.id), "Короткий ответ");
  const types = new Set<string | undefined>(target.prepare("SELECT field_id,schema_version FROM questionnaire_answers").all()
    .map((row) => field(published(target, Number(row.schema_version)), String(row.field_id))?.type));
  for (const type of ["SHORT_TEXT", "LONG_TEXT", "NUMBER", "DATE", "SINGLE_CHOICE", "MULTI_CHOICE", "SWITCH"]) assert.ok(types.has(type), `Missing stored source type ${type}`);
}));
test("source publication number gaps remain gaps; draft ordinal never becomes a historical publication", () => fixture((source, target) => {
  source.exec("UPDATE questionnaire_revisions SET revision=7 WHERE id='revision-2'; UPDATE questionnaire_revisions SET revision=8 WHERE id='revision-3'; UPDATE client_questionnaire_answers SET template_revision=7 WHERE template_revision=2");
  const input = read(source); prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  assert.deepEqual(target.prepare("SELECT version,base_version FROM questionnaire_versions ORDER BY version").all().map((row) => [row.version, row.base_version]), [[1, null], [7, 1], [8, 7]]);
  assert.equal(target.prepare("SELECT base_version FROM questionnaire_drafts").get()?.base_version, 8);
  assert.equal(target.prepare("SELECT schema_version FROM questionnaire_answers WHERE client_id=? AND value_json=?").get(secondId, '"Новый текст"')?.schema_version, 7);
}));
test("all new rows and IDs roll back on failures after IDs/cards/either profile/before commit", () => {
  for (const [stage, n] of [["after-ids", 1], ["after-client", 1], ["after-profile", 1], ["after-profile", 2], ["before-commit", 1]] as const) fixture((source, target) => {
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options); let seen = 0;
    assert.throws(() => ledger.stageClientQuestionnaires(input.cards, input.questionnaire, allocate(), (name) => { if (name === stage && ++seen === n) throw new Error("injected"); }), /WRITE_FAILED/u);
    for (const table of ["clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
    assert.equal(ledger.stageClientQuestionnaires(input.cards, input.questionnaire, allocate()).targetRows, 2);
  });
});
test("invalid pointer/revision/owner/schema never falls back to latest or commits partial clients", () => {
  for (const sql of ["UPDATE questionnaire_templates SET published_revision_id='missing'", "UPDATE questionnaire_templates SET published_revision_id='revision-1'",
    "UPDATE questionnaire_revisions SET revision=1 WHERE id='revision-2'", "UPDATE questionnaire_revisions SET workspace_id='foreign' WHERE id='revision-2'",
    "UPDATE client_questionnaire_answers SET client_id='orphan' WHERE client_id='a'", "UPDATE client_questionnaire_answers SET template_revision=3 WHERE client_id='a'",
    "UPDATE questionnaire_revisions SET schema_json='{broken' WHERE id='revision-2'", "UPDATE questionnaire_change_sets SET workspace_id='foreign'"]) fixture((source, target) => {
    source.exec(sql); const input = read(source); const ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientQuestionnaires(input.cards, input.questionnaire, allocate()), /QUESTIONNAIRE_/u);
    assert.equal(target.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0); assert.equal(ledger.loadClientDraftIds().clients.size, 0);
  });
});
test("duplicate profile wrappers are ambiguous instead of borrowing an arbitrary section", () => fixture((source, target) => {
  const changed = schema(2); changed.sections.push({ ...changed.sections[0]!, id: "second-goals", questions: [] });
  source.prepare("UPDATE questionnaire_revisions SET schema_json=? WHERE id='revision-2'").run(JSON.stringify(changed));
  const input = read(source); assert.throws(() => prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate()), /WRAPPER_AMBIGUOUS/u);
}));
test("stale derived projection and caller mutation cannot replace the admitted raw schema/answer data", () => fixture((source, target) => {
  const input = read(source); Object.assign(input.questionnaire.answers[0]!.projection!, { value: "wrong derived value" });
  prepareCandidateIdentityLedger(target, context, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate(), (stage) => {
    if (stage === "after-ids") Object.assign(input.questionnaire.revisions[0]!.raw, { schema_json: "{broken" });
  });
  assert.ok(field(published(target, 1), original("choice").id));
  assert.notEqual(target.prepare("SELECT value_json FROM questionnaire_answers WHERE client_id=? AND field_id=?").get(firstId, original("choice").id)?.value_json, '"wrong derived value"');
}));
test("separate mode binding preserves earlier profile stages; absent source tables remain distinguishable from broken templates", () => fixture((source, target) => {
  const input = read(source); const profileOnly = { clientIdentityRehearsal: { createdAt: options.clientIdentityRehearsal.createdAt, profiles: true as const } };
  prepareCandidateIdentityLedger(target, context, profileOnly).stageClientProfiles(input.cards, allocate());
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /CONTEXT_MISMATCH/u);
  const absent = new DatabaseSync(":memory:");
  try {
    const ledger = prepareCandidateIdentityLedger(absent, context, options);
    assert.throws(() => ledger.stageClientProfiles(input.cards, allocate()), /MODE_MISMATCH/u);
    ledger.stageClientQuestionnaires(input.cards, null, allocate());
    assert.equal(absent.prepare("SELECT count(*) AS n FROM questionnaire_versions").get()?.n, 1);
  } finally { absent.close(); }
}));
test("a source schema rename cannot silently rewrite an already committed historical publication on retry", () => fixture((source, target) => {
  const input = read(source); const ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientQuestionnaires(input.cards, input.questionnaire, allocate());
  const before = JSON.stringify(target.prepare("SELECT * FROM questionnaire_versions ORDER BY version").all());
  const changed = schema(1); changed.sections[0]!.questions[0]!.title = "Изменённый источник";
  source.prepare("UPDATE questionnaire_revisions SET schema_json=? WHERE id='revision-1'").run(JSON.stringify(changed));
  const updated = read(source);
  assert.throws(() => ledger.stageClientQuestionnaires(updated.cards, updated.questionnaire), /PROFILE_PARITY_MISMATCH/u);
  assert.equal(JSON.stringify(target.prepare("SELECT * FROM questionnaire_versions ORDER BY version").all()), before);
}));
test("reopen and reordered retry are byte-identical, while source/target drift is rejected without overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-questionnaire-")); const sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); source.close(); source = null;
    const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN"); const input = read(source);
    target = new DatabaseSync(targetPath); prepareCandidateIdentityLedger(target, { ...context, sourceSha256: sourceHash }, options).stageClientQuestionnaires(input.cards, input.questionnaire, allocate()); target.close(); target = null;
    const targetHash = createHash("sha256").update(readFileSync(targetPath)).digest("hex"); target = new DatabaseSync(targetPath);
    const ledger = prepareCandidateIdentityLedger(target, { ...context, sourceSha256: sourceHash }, options);
    input.cards = [...input.cards].reverse(); input.questionnaire.revisions.reverse(); input.questionnaire.answers.reverse();
    const result = ledger.stageClientQuestionnaires(input.cards, input.questionnaire, () => { throw new Error("must reuse IDs"); });
    assert.equal(result.insertedRows, 0); target.close(); target = null;
    assert.equal(createHash("sha256").update(readFileSync(targetPath)).digest("hex"), targetHash);
    target = new DatabaseSync(targetPath); const current = prepareCandidateIdentityLedger(target, { ...context, sourceSha256: sourceHash }, options);
    target.exec("UPDATE questionnaire_drafts SET schema_json='{}'");
    assert.throws(() => current.stageClientQuestionnaires(input.cards, input.questionnaire), /PARITY_MISMATCH/u);
    assert.equal(target.prepare("SELECT schema_json FROM questionnaire_drafts").get()?.schema_json, "{}");
    source.exec("ROLLBACK"); source.close(); source = null; target.close(); target = null;
    assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), sourceHash);
  } finally { source?.close(); target?.close(); rmSync(dir, { recursive: true, force: true }); }
});
