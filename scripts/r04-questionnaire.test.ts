import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { projectLegacyQuestionnaireSchema, projectLegacyQuestionnaireAnswer } from "./r04/LegacyQuestionnaireProjection.ts";
import { readLegacyQuestionnaireInSnapshot, summarizeLegacyQuestionnaire } from "./r04/LegacyQuestionnaireSourceReader.ts";

const question = (id: string, type: string, options: string[] = []) => ({ id, type, title: `Вопрос ${id}`,
  required: false, access: "trainer_only", options, hidden: false });
const schema = { version: 1, sections: [{ id: "synthetic-section", title: "Старая анкета", icon: "", hidden: false,
  questions: [question("text", "short_text"), question("long", "long_text"), question("number", "number"),
    question("date", "date"), question("one", "single_choice", ["Да", "Нет"]),
    question("multi", "multiple_choice", ["А", "Б"]), question("switch", "switch")] }] };
const project = (value: unknown = schema) => projectLegacyQuestionnaireSchema("synthetic-scope", "synthetic-workspace", value);

test("all seven legacy question types project into the actual v3 schema without default questions", () => {
  const projection = project();
  assert.equal(projection.schema.formatVersion, 1);
  assert.equal(projection.schema.sections.length, 1);
  assert.equal(projection.fields.size, 7);
  assert.deepEqual([...projection.fields.values()].map((field) => field.type),
    ["SHORT_TEXT", "LONG_TEXT", "NUMBER", "DATE", "SINGLE_CHOICE", "MULTI_CHOICE", "SWITCH"]);
  assert.ok([...projection.fields.values()].every((field) => field.origin === "CUSTOM" && field.semanticKey === null));
});

test("field and option IDs survive renames, option reordering and projection retry", () => {
  const updated = structuredClone(schema);
  updated.sections[0]!.questions[4]!.title = "Новое название";
  updated.sections[0]!.questions[4]!.options.reverse();
  const first = project(), second = project(updated);
  assert.equal(first.fields.get("one")?.id, second.fields.get("one")?.id);
  assert.equal(first.legacyOptionIds.get("one")?.get("Да"), second.legacyOptionIds.get("one")?.get("Да"));
  assert.deepEqual(project().schema, first.schema);
  assert.notEqual(projectLegacyQuestionnaireSchema("other", "synthetic-workspace", schema).fields.get("one")?.id, first.fields.get("one")?.id);
});

test("choice answer labels translate to option IDs without label matching guesses", () => {
  const projection = project();
  assert.equal(projectLegacyQuestionnaireAnswer(projection, "one", "Да").value, projection.legacyOptionIds.get("one")?.get("Да"));
  assert.deepEqual(projectLegacyQuestionnaireAnswer(projection, "multi", ["Б", "А"]).value,
    [projection.legacyOptionIds.get("multi")?.get("Б"), projection.legacyOptionIds.get("multi")?.get("А")]);
  assert.throws(() => projectLegacyQuestionnaireAnswer(projection, "one", "да"), /OPTION_UNKNOWN/u);
});

test("zero, false, explicit null, text whitespace and source dates retain their actual values", () => {
  const projection = project();
  for (const [field, value] of [["number", 0], ["switch", false], ["text", "  Текст  "], ["date", "2026-01-01"], ["one", null]] as const) {
    assert.deepEqual(projectLegacyQuestionnaireAnswer(projection, field, value).value, value);
  }
});

test("invalid answer types, unknown fields/options and duplicate choices block conversion", () => {
  const projection = project();
  assert.throws(() => projectLegacyQuestionnaireAnswer(projection, "number", "20"), /VALUE_INVALID/u);
  assert.throws(() => projectLegacyQuestionnaireAnswer(projection, "date", "2026-02-30"), /VALUE_INVALID/u);
  assert.throws(() => projectLegacyQuestionnaireAnswer(projection, "missing", "text"), /FIELD_UNKNOWN/u);
  assert.throws(() => projectLegacyQuestionnaireAnswer(projection, "multi", ["А", "А"]), /OPTIONS_AMBIGUOUS/u);
});

test("unknown question type/properties and duplicate source IDs never become guessed fields", () => {
  const unknown = structuredClone(schema); unknown.sections[0]!.questions[0]!.type = "__proto__";
  assert.throws(() => project(unknown), /SCHEMA_INVALID/u);
  const duplicate = structuredClone(schema); duplicate.sections[0]!.questions.push(duplicate.sections[0]!.questions[0]!);
  assert.throws(() => project(duplicate), /IDENTITY_INVALID/u);
  const advanced = structuredClone(schema);
  Object.assign(advanced.sections[0]!.questions[0]!, { visibleIf: { field: "other" } });
  assert.throws(() => project(advanced), /UNSUPPORTED_FIELD_PROPERTIES/u);
});

test("duplicate option labels are ambiguous rather than collapsed", () => {
  const duplicate = structuredClone(schema); duplicate.sections[0]!.questions[4]!.options = ["Да", "Да"];
  assert.throws(() => project(duplicate), /OPTIONS_AMBIGUOUS/u);
});

test("protected billing/notes sections cannot become editable system sections", () => {
  const protectedSchema = structuredClone(schema);
  Object.assign(protectedSchema.sections[0]!, { legacySectionId: "billing" });
  assert.throws(() => project(protectedSchema), /PROTECTED_SECTION/u);
});

const timestamp = "2026-01-01T10:00:00Z";
function fixture(run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT);
      INSERT INTO clients VALUES('synthetic-client','synthetic-workspace');
      CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
      CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
      CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));`);
    for (const [id, version, status] of [["synthetic-published", 1, "published"], ["synthetic-draft", 2, "draft"]]) {
      db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(
        id!, "synthetic-workspace", version!, status!, JSON.stringify(schema), timestamp, status === "published" ? timestamp : null);
    }
    db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run("synthetic-workspace", "synthetic-draft", "synthetic-published", timestamp);
    db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run("synthetic-client", "one", '"Да"', 1, timestamp, null);
    run(db);
  } finally { db.close(); }
}
const read = (db: DatabaseSync) => readLegacyQuestionnaireInSnapshot(db, "synthetic-scope")!;

test("reader preserves raw revisions and converts answer using its exact published version", () => fixture((db) => {
  const result = read(db);
  assert.equal(result.revisions.length, 2);
  assert.equal(result.answers[0]?.raw.value_json, '"Да"');
  assert.ok(result.answers[0]?.projection?.value);
  assert.deepEqual(result.answers[0]?.issues, []);
  assert.deepEqual(result.templates[0]?.issues, []);
}));

test("deleted and hidden answers remain in inventory without becoming active answers", () => fixture((db) => {
  db.prepare("UPDATE client_questionnaire_answers SET deleted_at=?").run(timestamp);
  const hiddenSchema = structuredClone(schema);
  hiddenSchema.sections[0]!.questions[4]!.hidden = true;
  db.prepare("UPDATE questionnaire_revisions SET schema_json=?").run(JSON.stringify(hiddenSchema));
  const result = read(db);
  assert.equal(result.answers.length, 1);
  assert.equal(result.answers[0]?.raw.deleted_at, timestamp);
  assert.equal(result.revisions[0]?.projection?.fields.get("one")?.hidden, true);
  assert.ok(result.answers[0]?.projection !== null);
  assert.equal(summarizeLegacyQuestionnaire(result).deletedAnswerRows, 1);
  assert.equal(summarizeLegacyQuestionnaire(result).targetWrites, 0);
}));

test("unresolved version never silently falls back to latest schema", () => fixture((db) => {
  db.exec("UPDATE client_questionnaire_answers SET template_revision=0");
  const answer = read(db).answers[0]!;
  assert.equal(answer.projection, null);
  assert.ok(answer.issues.includes("R04_QUESTIONNAIRE_ANSWER_REVISION_UNRESOLVED"));
}));

test("foreign workspace pointers and orphan client answers remain unresolved", () => fixture((db) => {
  db.exec("UPDATE questionnaire_templates SET workspace_id='foreign'; UPDATE client_questionnaire_answers SET client_id='missing'");
  const result = read(db);
  assert.ok(result.templates[0]?.issues.includes("R04_QUESTIONNAIRE_TEMPLATE_REFERENCE_INVALID"));
  assert.ok(result.answers[0]?.issues.includes("R04_QUESTIONNAIRE_ANSWER_OWNER_MISSING"));
}));

test("malformed values retain original JSON without being cleared", () => fixture((db) => {
  db.exec("UPDATE client_questionnaire_answers SET value_json='{broken'");
  const answer = read(db).answers[0]!;
  assert.equal(answer.raw.value_json, "{broken");
  assert.equal(answer.projection, null);
  assert.ok(answer.issues.includes("R04_QUESTIONNAIRE_JSON_INVALID"));
}));

test("same revision number in multiple rows is unresolved, not an arbitrary first match", () => fixture((db) => {
  db.exec("UPDATE questionnaire_revisions SET revision=1");
  assert.equal(read(db).answers[0]?.projection, null);
}));

test("absent questionnaire tables differ from partial unsupported schema", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.equal(readLegacyQuestionnaireInSnapshot(db, "scope"), null);
    db.exec("CREATE TABLE questionnaire_templates(workspace_id TEXT)");
    assert.throws(() => readLegacyQuestionnaireInSnapshot(db, "scope"), /TABLES_INCOMPLETE/u);
  } finally { db.close(); }
});

test("public aggregate includes counts without answers, labels, IDs or personal values", () => fixture((db) => {
  const report = summarizeLegacyQuestionnaire(read(db));
  assert.equal(report.revisionRows, 2);
  assert.equal(report.projectedAnswerCandidates, 1);
  assert.equal(report.answersRequiringReview, 0);
  assert.doesNotMatch(JSON.stringify(report), /synthetic|Да|Вопрос|value_json|legacy:/u);
}));
