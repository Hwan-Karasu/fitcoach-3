import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { legacyProfileQuestionnaireSchema, projectLegacyClientProfile } from "./r04/LegacyClientProfileProjection.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { projectLegacyClientCard, readLegacyClientCardsInSnapshot, summarizeLegacyClientCards } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyClientIdentityInSnapshot, type LegacyClientIdentityCandidate } from "./r04/LegacyClientIdentitySourceReader.ts";
import { allFields, validateSchema } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireRules.ts";

const context = { sourceSha256: "a".repeat(64), accountScope: "synthetic-scope", sourceWorkspaceId: "synthetic-workspace", targetWorkspaceId: "local-trainer" };
const timestamp = "2026-01-02T10:00:00Z";
const options = { clientIdentityRehearsal: { createdAt: timestamp, profiles: true as const } };
const firstId = "11111111-1111-4111-8111-111111111111", secondId = "22222222-2222-4222-8222-222222222222";
function profile() {
  return { goals: ["Сбросить вес"], goalsOther: "Другая цель", muscles: ["Бедра", "Руки: бицепс"],
    successCriteria: ["Изменение веса"], successCriteriaOther: "Синтетический критерий", deadline: "3 месяца",
    diagnoses: "Синтетический диагноз", healthCleared: false, medications: "Синтетический препарат", supplements: "Нет",
    injuries: "Синтетическая травма", surgeries: "Нет", pain: "Синтетическая боль", hardMovements: "Синтетическое движение",
    currentActivity: "Две тренировки", sportHistory: "Синтетический опыт", fitnessLevel: "5", job: "Синтетическая работа",
    sittingHours: "2-4 часа", sleep: "8 часов", habits: "Синтетическая привычка", steps: "5000", gymAccess: "Синтетический зал",
    bodySatisfaction: "Нет, хочу изменить", weightHistory: "Синтетическая история веса", dietRestrictions: "Синтетическое ограничение",
    eatingBehavior: "Синтетическая привычка питания", motivation: "Синтетическая мотивация", obstacles: "Синтетическое препятствие",
    support: "Синтетическая поддержка", trainerExpectations: ["Конкретика и четкий план"], trainerTags: ["Синтетическая метка"],
    menstrualCycle: "Синтетические сведения", trainerExperience: "Синтетический опыт с тренером", unwantedLoad: "Синтетическая нежелательная нагрузка",
    trainerNotes: "  Синтетическая заметка без изменения пробелов  ", photo: "file:///synthetic/photo.jpg" };
}
function card(id = "a", input: Readonly<Record<string, unknown>> = profile()) {
  const identity: LegacyClientIdentityCandidate = { sourceIdentityKey: JSON.stringify([context.accountScope, id]), accountScope: context.accountScope,
    sourceClientId: id, sourceWorkspaceId: context.sourceWorkspaceId, displayName: `Синтетический клиент ${id}`,
    createdAt: "2026-01-01T10:00:00Z", updatedAt: timestamp, archivedAt: null, lifecycleCandidate: "ACTIVE", issues: [], targetWorkspaceId: null, targetClientId: null };
  return projectLegacyClientCard(identity, { id, workspace_id: context.sourceWorkspaceId, birthdate: "2000-01-01", height: "180,5", gender: "Мужской",
    avatar_emoji: "🏋️", profile_json: JSON.stringify(input), weight: "80", session_pack_total: "12", session_pack_used: "2", session_price: "1500" });
}
function memory(run: (db: DatabaseSync) => void) { const db = new DatabaseSync(":memory:"); try { run(db); } finally { db.close(); } }
function allocation() { const ids = [firstId, secondId]; return () => ids.shift()!; }
function answer(db: DatabaseSync, field: string, client = firstId): unknown {
  const row = db.prepare("SELECT value_json FROM questionnaire_answers WHERE client_id=? AND field_id=?").get(client, field);
  return row ? JSON.parse(String(row.value_json)) as unknown : undefined;
}

test("all 37 build120 profile fields are accounted for without guessing work-data ownership", () => {
  const raw = profile(), saved = structuredClone(raw), result = projectLegacyClientProfile(raw);
  assert.equal(Object.keys(raw).length, 37); assert.equal(result.sourceFields, 37); assert.deepEqual(result.issues, []);
  assert.deepEqual(raw, saved); assert.equal(result.workData.trainerNote, raw.trainerNotes);
  assert.deepEqual(result.workData.manualTags, raw.trainerTags); assert.equal(result.workData.loadAvoidance, raw.unwantedLoad);
  assert.deepEqual(result.excludedByProduct, [{ sourceField: "steps", value: raw.steps }, { sourceField: "photo", value: raw.photo }]);
  assert.equal(result.answers!["sys:health.noContra"], false);
  assert.equal(result.answers!["legacy:profile:successCriteriaOther"], raw.successCriteriaOther);
  assert.equal(result.answers!["legacy:profile:gymAccess"], raw.gymAccess);
  assert.equal(Object.keys(result.answers!).length, 32);
});
test("verified option spelling changes yield actual stable option IDs, never free text", () => {
  const schema = legacyProfileQuestionnaireSchema(), fields = new Map(allFields(schema).map(({ field }) => [field.id, field]));
  const result = projectLegacyClientProfile(profile()).answers!;
  assert.equal(validateSchema(schema).length, 0);
  const label = (field: string, value: unknown) => fields.get(field)!.options.find((option) => option.id === value)?.label;
  assert.deepEqual((result["sys:goals.muscles"] as string[]).map((id) => label("sys:goals.muscles", id)), ["Бёдра", "Бицепс"]);
  assert.equal(label("sys:lifestyle.sitting", result["sys:lifestyle.sitting"]), "2–4 часа");
  assert.equal(label("sys:motivation.expectations", (result["sys:motivation.expectations"] as string[])[0]), "Конкретика и чёткий план");
  assert.deepEqual(projectLegacyClientProfile(profile()).answers, result);
});
test("sparse profiles have absent answers, explicit false remains false, and source empties remain empty", () => {
  assert.deepEqual(projectLegacyClientProfile({}).answers, {});
  const result = projectLegacyClientProfile({ healthCleared: false, goals: [], goalsOther: "  ", fitnessLevel: "" });
  assert.deepEqual(result.answers, { "sys:health.noContra": false, "sys:goals.main": [], "sys:goals.other": "  " });
});
test("unknown choices, duplicate aliases, unknown properties and malformed types block the whole profile", () => {
  for (const input of [{ goals: ["угаданная цель"] }, { muscles: ["Руки: бицепс", "Бицепс"] }, { trainerTags: ["x", "x"] },
    { fitnessLevel: 5 }, { healthCleared: "false" }, { photo: {} }, { goals: [false] }, { __newProperty: "new" }]) {
    assert.equal(projectLegacyClientProfile(input).answers, null);
    assert.ok(projectLegacyClientProfile(input).issues.length > 0);
  }
});
test("clearance cannot hide retained diagnoses/injuries/pain; explicit no-data legacy markers are not guessed diagnoses", () => {
  assert.equal(projectLegacyClientProfile({ healthCleared: true, injuries: "Синтетическая травма" }).answers, null);
  assert.ok(projectLegacyClientProfile({ healthCleared: true, diagnoses: "Синтетический диагноз" }).issues.includes("R04_PROFILE_CLEARANCE_CONFLICT"));
  const result = projectLegacyClientProfile({ healthCleared: true, diagnoses: "Нет", injuries: "—", pain: "не указано" });
  assert.equal(result.answers!["sys:health.noContra"], true); assert.equal(result.answers!["sys:health.diagnoses"], "Нет");
});
test("oversized mapped text is blocked rather than silently truncated", () => {
  const result = projectLegacyClientProfile({ diagnoses: "я".repeat(4001) });
  assert.equal(result.answers, null); assert.ok(result.issues.includes("R04_PROFILE_ANSWER_INVALID"));
});
test("card, stable client ID, actual questionnaire values and provenance commit together", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options); const input = [card(), card("b", { healthCleared: false })];
  const result = ledger.stageClientProfiles(input, allocation());
  assert.equal(result.status, "profile-rehearsal-staged"); assert.equal(result.targetRows, 2); assert.equal(result.profileRows, 2);
  assert.equal(result.answerRows, 33); assert.equal(result.pendingWorkDataRows, 1); assert.equal(result.finalizable, false);
  assert.equal(answer(db, "sys:health.noContra"), false); assert.equal(answer(db, "sys:health.diagnoses"), profile().diagnoses);
  assert.equal(answer(db, "sys:health.noContra", secondId), false); assert.equal(answer(db, "sys:health.diagnoses", secondId), undefined);
  assert.equal(db.prepare("SELECT schema_version,updated_at FROM questionnaire_answers WHERE client_id=? LIMIT 1").get(firstId)?.updated_at, timestamp);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  const schema = JSON.parse(String(db.prepare("SELECT schema_json FROM questionnaire_versions").get()?.schema_json)) as ReturnType<typeof legacyProfileQuestionnaireSchema>;
  assert.equal(validateSchema(schema).length, 0); assert.equal(schema.sections.some((s) => s.fields.some((f) => /trainerNotes|unwantedLoad|trainerTags/u.test(f.id))), false);
  const receipt = String(db.prepare("SELECT target_json FROM r04_profile_receipt").get()?.target_json);
  assert.ok(receipt.includes(profile().trainerNotes)); assert.ok(receipt.includes(profile().unwantedLoad));
  assert.doesNotMatch(JSON.stringify(result), /Синтетич|file:|profile_json|legacy:|11111111/u);
}));
test("replay and a new connection keep IDs, values, dates and revision without any allocator call", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-profile-")), path = join(dir, "stage.db");
  try {
    const source = [card(), card("b")]; let db = new DatabaseSync(path);
    prepareCandidateIdentityLedger(db, context, options).stageClientProfiles(source, allocation()); db.close();
    const before = createHash("sha256").update(readFileSync(path)).digest("hex"); db = new DatabaseSync(path);
    const ledger = prepareCandidateIdentityLedger(db, context, options);
    const result = ledger.stageClientProfiles([...source].reverse(), () => { throw new Error("must reuse mapped ID"); });
    assert.equal(result.insertedRows, 0); assert.equal(result.unchangedRows, 2); assert.equal(answer(db, "sys:health.noContra"), false);
    assert.equal(db.prepare("SELECT count(*) AS n FROM questionnaire_versions").get()?.n, 1); db.close();
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("every client/profile checkpoint failure rolls back all new IDs, cards, schema, answers and receipt", () => {
  for (const [stage, occurrence] of [["after-ids", 1], ["after-client", 1], ["after-client", 2], ["after-profile", 1], ["after-profile", 2], ["before-commit", 1]] as const) memory((db) => {
    const ledger = prepareCandidateIdentityLedger(db, context, options); let seen = 0;
    assert.throws(() => ledger.stageClientProfiles([card(), card("b")], allocation(), (name) => { if (name === stage && ++seen === occurrence) throw new Error("injected"); }), /WRITE_FAILED/u);
    for (const table of ["clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt"]) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
    assert.equal(ledger.stageClientProfiles([card(), card("b")], allocation()).targetRows, 2);
  });
});
test("blocked profile rolls back new records and preserves IDs committed before this attempt", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options); ledger.reserveClientIds([card().identity.sourceIdentityKey], () => firstId);
  assert.throws(() => ledger.stageClientProfiles([card("a", { unknown: "do not drop" }), card("b")], () => secondId), /PROFILE_BLOCKED/u);
  assert.equal(ledger.loadClientDraftIds().clients.size, 1); assert.equal(db.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
}));
test("replay rejects target tampering, extra answers and changed source without replacing anything", () => {
  for (const mutation of ["value", "extra", "source", "receipt"] as const) memory((db) => {
    const ledger = prepareCandidateIdentityLedger(db, context, options); ledger.stageClientProfiles([card()], () => firstId);
    let source = card();
    if (mutation === "value") db.prepare("UPDATE questionnaire_answers SET value_json='true' WHERE field_id='sys:health.noContra'").run();
    else if (mutation === "extra") db.prepare("INSERT INTO questionnaire_answers VALUES(?,?,?,'0',1,?)").run(context.targetWorkspaceId, firstId, "foreign-field", timestamp);
    else if (mutation === "receipt") db.prepare("UPDATE r04_profile_receipt SET target_json='{}'").run();
    else source = card("a", { ...profile(), diagnoses: "Изменённый источник" });
    const before = JSON.stringify(db.prepare("SELECT * FROM questionnaire_answers ORDER BY field_id").all());
    assert.throws(() => ledger.stageClientProfiles([source]), /PARITY_MISMATCH/u);
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM questionnaire_answers ORDER BY field_id").all()), before);
  });
});
test("profile opt-in binding never claims an earlier identity-only rehearsal", () => memory((db) => {
  const legacyOptions = { clientIdentityRehearsal: { createdAt: timestamp } };
  const old = prepareCandidateIdentityLedger(db, context, legacyOptions);
  assert.throws(() => old.stageClientProfiles([card()]), /PROFILE_NOT_ENABLED/u);
  assert.throws(() => prepareCandidateIdentityLedger(db, context, options), /FOREIGN_DATABASE|CONTEXT_MISMATCH/u);
}));
test("profile staging does not commit or roll back a caller-owned outer transaction", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options); db.exec("BEGIN IMMEDIATE");
  assert.throws(() => ledger.stageClientProfiles([card()]), /TRANSACTION_REQUIRED_EXCLUSIVE/u);
  assert.equal(db.isTransaction, true); db.exec("ROLLBACK");
}));
test("profile is reprojected from retained raw JSON rather than trusting a stale derived object", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options); const input = card();
  Object.assign(input.legacyProfile!, { diagnoses: "Different derived object" });
  ledger.stageClientProfiles([input], () => firstId);
  assert.equal(answer(db, "sys:health.diagnoses"), profile().diagnoses);
}));
test("full card audit exposes only profile counts and never notes, choice labels, raw payload or IDs", () => {
  const result = summarizeLegacyClientCards([card(), card("b", { unknown: true })]);
  assert.equal(result.profileAnswerCandidates, 32); assert.equal(result.profilesRequiringReview, 1); assert.equal(result.workDataCandidateRows, 1);
  assert.equal(result.targetWrites, 0); assert.doesNotMatch(JSON.stringify(result), /Синтетич|111111|local-trainer|file:|diagnoses|profile_json/u);
});
test("known client cards can advance to profile phase and mutable caller data cannot change the admitted source", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options); const input = [card()];
  ledger.stageClientCards(input, () => firstId);
  const before = structuredClone(input);
  ledger.stageClientProfiles(input, () => { throw new Error("reuse"); }, (stage) => {
    if (stage === "after-ids") Object.assign(input[0]!.legacyProfile!, { diagnoses: "Mutated caller" });
  });
  assert.equal(answer(db, "sys:health.diagnoses"), before[0]!.legacyProfile!.diagnoses);
}));
test("read-only synthetic source file reaches staged active/archived cards and answers without changing source SHA", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-profile-source-")); const sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath);
    source.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,
      birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT,weight TEXT)`);
    for (const [id, value, archived] of [["a", profile(), null], ["b", {}, timestamp]] as const) source.prepare("INSERT INTO clients VALUES(?,?,?,?,?,?,NULL,?,?,?,?,?,?)")
      .run(id, context.sourceWorkspaceId, `Синтетический ${id}`, "2026-01-01T10:00:00Z", timestamp, archived, "2000-01-01", "180,5", "Мужской", "🏋️", JSON.stringify(value), "80");
    source.close(); source = null;
    const before = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN");
    const cards = readLegacyClientCardsInSnapshot(source, context.accountScope, readLegacyClientIdentityInSnapshot(source, context.accountScope));
    target = new DatabaseSync(targetPath);
    const result = prepareCandidateIdentityLedger(target, { ...context, sourceSha256: before }, options).stageClientProfiles(cards, allocation());
    assert.equal(result.profileRows, 2); assert.equal(result.answerRows, 32);
    assert.deepEqual(target.prepare("SELECT lifecycle FROM clients ORDER BY id").all().map((row) => row.lifecycle), ["ACTIVE", "ARCHIVED"]);
    assert.equal(answer(target, "sys:health.diagnoses"), profile().diagnoses);
    assert.equal(target.prepare("SELECT count(*) AS n FROM questionnaire_answers WHERE client_id=?").get(secondId)?.n, 0);
    source.exec("ROLLBACK"); source.close(); source = null; target.close(); target = null;
    assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), before);
  } finally { source?.close(); target?.close(); rmSync(dir, { recursive: true, force: true }); }
});
