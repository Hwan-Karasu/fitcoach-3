import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevQuestionnaireRepository, devQuestionnaireClientDeletionParticipant } from
  "../apps/mobile/src/features/questionnaire/data/DevQuestionnaireRepository.ts";
import type { QuestionField, QuestionnaireSchema } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireModel.ts";
import { answerProblem, completionStatus, defaultQuestionnaireSchema, isFieldVisible, parseDateInput, parseNumberInput,
  publishSummary, validateSchema } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const TODAY = "2026-10-16";

async function stores(participants = true) {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, participants ? [devQuestionnaireClientDeletionParticipant] : []);
  await clients.initialize();
  const questionnaire = new DevQuestionnaireRepository(shared, WS);
  await questionnaire.initialize();
  const close = async () => { await questionnaire.close(); await clients.close(); };
  return { db, clients, questionnaire, close };
}

const custom = (id: string, type: QuestionField["type"], extra: Partial<QuestionField> = {}): QuestionField => ({
  id, origin: "CUSTOM", semanticKey: null, type, label: id, help: null, required: false, hidden: false, retired: false,
  options: [], visibleIf: null, constraints: null, ...extra });

function withFields(schema: QuestionnaireSchema, fields: readonly QuestionField[]): QuestionnaireSchema {
  const [first, ...rest] = schema.sections;
  return { ...schema, sections: [{ ...first!, fields: [...first!.fields, ...fields] }, ...rest] };
}

test("Q validation: type checks and per-field constraints give plain messages", () => {
  const age = custom("age", "NUMBER", { constraints: { min: 14, max: 99, integer: true } });
  assert.equal(answerProblem(age, 30, undefined, TODAY), null);
  assert.equal(answerProblem(age, 30.5, undefined, TODAY), "Нужно целое число.");
  assert.equal(answerProblem(age, 12, undefined, TODAY), "Не меньше 14.");
  assert.equal(answerProblem(age, 120, undefined, TODAY), "Не больше 99.");
  assert.equal(answerProblem(age, "30", undefined, TODAY), "Введите число, например 12 или 80,5.");
  const injury = custom("injury", "DATE", { constraints: { notFuture: true, notBefore: "1950-01-01" } });
  assert.equal(answerProblem(injury, "2026-10-17", undefined, TODAY), "Дата не может быть в будущем.");
  assert.equal(answerProblem(injury, "1949-12-31", undefined, TODAY), "Не раньше 01.01.1950.");
  assert.equal(answerProblem(injury, "2026-02-30", undefined, TODAY), "Дата в формате ДД.ММ.ГГГГ.");
  const note = custom("note", "SHORT_TEXT", { constraints: { maxLength: 5 } });
  assert.equal(answerProblem(note, "  abcde  ", undefined, TODAY), null);
  assert.equal(answerProblem(note, "abcdef", undefined, TODAY), "Не больше 5 символов (сейчас 6).");
  assert.equal(answerProblem(custom("long", "LONG_TEXT"), "x".repeat(4001), undefined, TODAY), "Не больше 4000 символов (сейчас 4001).");
  const choice = custom("pick", "SINGLE_CHOICE", { options: [{ id: "a", label: "A", retired: false }, { id: "b", label: "B", retired: true }] });
  assert.equal(answerProblem(choice, "a", undefined, TODAY), null);
  assert.equal(answerProblem(choice, "b", undefined, TODAY), "Выберите один из вариантов.");
  assert.equal(answerProblem(choice, "b", "b", TODAY), null);
  assert.equal(answerProblem(custom("flag", "SWITCH"), "yes", undefined, TODAY), "Выберите «да» или «нет».");
  assert.equal(parseNumberInput(" 80,5 "), 80.5);
  assert.equal(parseNumberInput("12a"), "invalid");
  assert.equal(parseDateInput("5.3.2020"), "2020-03-05");
  assert.equal(parseDateInput("31.02.2020"), "invalid");
  assert.ok(validateSchema(withFields(defaultQuestionnaireSchema(), [custom("bad", "NUMBER", { constraints: { min: 5, max: 1 } })]))
    .some((issue) => issue.message === "минимум больше максимума"));
});

test("Q-02 conditional visibility and completion: hidden required never blocks COMPLETE", () => {
  const schema = defaultQuestionnaireSchema();
  assert.equal(completionStatus(schema, {}), "NOT_STARTED");
  assert.equal(isFieldVisible(schema, "sys:health.diagnoses", {}), true);
  assert.equal(isFieldVisible(schema, "sys:health.diagnoses", { "sys:health.noContra": true }), false);
  const conditional = withFields(schema, [custom("detail", "SHORT_TEXT", { required: true,
    visibleIf: { sourceFieldId: "sys:health.noContra", operator: "EQUALS", value: "false" } })]);
  const goals = { "sys:goals.main": ["sys:goals.main:o1"] };
  assert.equal(completionStatus(conditional, goals), "COMPLETE");
  assert.equal(completionStatus(conditional, { ...goals, "sys:health.noContra": false }), "IN_PROGRESS");
  assert.equal(completionStatus(conditional, { ...goals, "sys:health.noContra": false, detail: "астма" }), "COMPLETE");
  assert.equal(completionStatus(conditional, { "sys:lifestyle.sleep": "8 часов" }), "IN_PROGRESS");
});

test("Q-04 a dependency cycle or broken reference blocks Publish without a new version", async () => {
  const cyclic = withFields(defaultQuestionnaireSchema(), [
    custom("a", "SHORT_TEXT", { visibleIf: { sourceFieldId: "b", operator: "EQUALS", value: "x" } }),
    custom("b", "SHORT_TEXT", { visibleIf: { sourceFieldId: "a", operator: "EQUALS", value: "x" } }),
    custom("c", "SINGLE_CHOICE", { options: [{ id: "c1", label: "C", retired: false }],
      visibleIf: { sourceFieldId: "sys:goals.main", operator: "EQUALS", value: "missing-option" } }),
  ]);
  const messages = validateSchema(cyclic).map((issue) => issue.message);
  assert.ok(messages.includes("условия образуют цикл"));
  assert.ok(messages.includes("условие ссылается на удалённый вариант ответа"));
  const { questionnaire, close } = await stores();
  try {
    const draft = await questionnaire.getDraft();
    const saved = await questionnaire.saveDraft(draft.revision, cyclic);
    await assert.rejects(questionnaire.publishDraft(saved.revision), { message: "QUESTIONNAIRE_SCHEMA_INVALID" });
    assert.equal((await questionnaire.getPublished()).version, 1);
    assert.equal((await questionnaire.listVersions()).length, 1);
  } finally { await close(); }
});

test("Q-01/Q-03 answers live apart from the client card; hide and rename keep them; Publish is immutable", async () => {
  const { db, clients, questionnaire, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Анна" });
    assert.equal(await questionnaire.completion(client.id), "NOT_STARTED");
    await assert.rejects(questionnaire.saveAnswers(client.id, { "sys:lifestyle.fitness": "nope" }),
      { message: "QUESTIONNAIRE_ANSWER_INVALID" });
    await questionnaire.saveAnswers(client.id, { "sys:goals.main": ["sys:goals.main:o2"], "sys:lifestyle.sleep": " 7 часов ",
      "sys:health.noContra": false });
    assert.equal((await questionnaire.getAnswers(client.id)).answers["sys:lifestyle.sleep"], "7 часов");
    assert.equal(await questionnaire.completion(client.id), "COMPLETE");
    await questionnaire.saveAnswers(client.id, { "sys:lifestyle.sleep": null });
    assert.equal((await questionnaire.getAnswers(client.id)).answers["sys:lifestyle.sleep"], undefined);
    let draft = await questionnaire.getDraft();
    const hidden: QuestionnaireSchema = { ...draft.schema, sections: draft.schema.sections.map((item) => ({ ...item,
      fields: item.fields.map((entry) => entry.id === "sys:goals.main" ? { ...entry, hidden: true, label: "Цели клиента" } : entry) })) };
    draft = await questionnaire.saveDraft(draft.revision, hidden);
    assert.deepEqual({ ...(await questionnaire.previewPublish()) },
      { added: 0, changed: 1, hidden: 1, retired: 0, removed: 0, moved: 0, sections: 0 });
    const v2 = await questionnaire.publishDraft(draft.revision);
    assert.equal(v2.version, 2);
    assert.deepEqual((await questionnaire.getAnswers(client.id)).answers["sys:goals.main"], ["sys:goals.main:o2"]);
    assert.equal((await questionnaire.getVersion(1)).schema.sections[0]?.fields[0]?.hidden, false);
    assert.throws(() => db.exec("UPDATE questionnaire_versions SET published_at = 'x'"), /QUESTIONNAIRE_VERSION_IMMUTABLE/u);
    draft = await questionnaire.getDraft();
    await assert.rejects(questionnaire.publishDraft(draft.revision), { message: "QUESTIONNAIRE_NOTHING_TO_PUBLISH" });
    const removed: QuestionnaireSchema = { ...draft.schema, sections: draft.schema.sections.map((item) => ({ ...item,
      fields: item.fields.filter((entry) => entry.id !== "sys:goals.main") })) };
    draft = await questionnaire.saveDraft(draft.revision, removed);
    await assert.rejects(questionnaire.publishDraft(draft.revision), { message: "QUESTIONNAIRE_ANSWERED_FIELD_REMOVED" });
    assert.equal((await questionnaire.getPublished()).version, 2);
  } finally { await close(); }
});

test("Q-05/Q-06 stale autosave and stale base never overwrite; restore makes a new linear version", async () => {
  const { questionnaire, close } = await stores();
  try {
    const start = await questionnaire.getDraft();
    const changed = withFields(start.schema, [custom("fresh", "SHORT_TEXT")]);
    const newer = await questionnaire.saveDraft(start.revision, changed);
    await assert.rejects(questionnaire.saveDraft(start.revision, start.schema), { message: "QUESTIONNAIRE_DRAFT_STALE" });
    assert.ok(JSON.stringify((await questionnaire.getDraft()).schema).includes("fresh"));
    const v2 = await questionnaire.publishDraft(newer.revision);
    assert.equal(v2.version, 2);
    assert.deepEqual({ ...publishSummary(start.schema, v2.schema) }, { added: 1, changed: 0, hidden: 0, retired: 0,
      removed: 0, moved: 0, sections: 0 });
    const restored = await questionnaire.draftFromVersion(1);
    assert.equal(restored.baseVersion, 2);
    const v3 = await questionnaire.publishDraft(restored.revision);
    assert.equal(v3.version, 3);
    assert.deepEqual((await questionnaire.listVersions()).map((row) => row.version), [3, 2, 1]);
    const dirty = await questionnaire.saveDraft((await questionnaire.getDraft()).revision, changed);
    const discarded = await questionnaire.discardDraft();
    assert.equal(discarded.revision, dirty.revision + 1);
    assert.equal(JSON.stringify(discarded.schema), JSON.stringify((await questionnaire.getPublished()).schema));
  } finally { await close(); }
});

test("§15.7 permanent client delete removes only that client's answers; without the owner it fails closed", async () => {
  const { clients, questionnaire, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "Gone" });
    const kept = await clients.create({ displayName: "Kept" });
    await questionnaire.saveAnswers(gone.id, { "sys:lifestyle.sleep": "6" });
    await questionnaire.saveAnswers(kept.id, { "sys:lifestyle.sleep": "8" });
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.deepEqual({ ...(await questionnaire.getAnswers(gone.id)).answers }, {});
    assert.equal((await questionnaire.getAnswers(kept.id)).answers["sys:lifestyle.sleep"], "8");
  } finally { await close(); }
  const blocked = await stores(false);
  try {
    const client = await blocked.clients.create({ displayName: "Blocked" });
    await blocked.questionnaire.saveAnswers(client.id, { "sys:lifestyle.sleep": "6" });
    const archived = await blocked.clients.setArchived(client.id, client.revision, true);
    await assert.rejects(blocked.clients.deleteArchivedPermanently(client.id, archived.revision),
      { message: "CLIENT_DELETION_BLOCKED" });
  } finally { await blocked.close(); }
});
