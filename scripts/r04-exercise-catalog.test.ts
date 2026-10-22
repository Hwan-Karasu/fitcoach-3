import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot, summarizeLegacyExercises } from "./r04/LegacyExerciseReferencePreflight.ts";

const scope = "synthetic-account";
const timestamp = "2026-01-01T10:00:00Z";

function fixture(run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE exercise_catalog (
      id TEXT PRIMARY KEY,name TEXT,category TEXT,equipment TEXT,aliases_json TEXT,
      source TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
      CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE training_workouts (id TEXT PRIMARY KEY,client_id TEXT);
      CREATE TABLE training_exercises (id TEXT PRIMARY KEY,workout_id TEXT,name TEXT,
        template_exercise_id TEXT,data_json TEXT,deleted_at TEXT,note TEXT);
      CREATE TABLE training_exercise_history (id TEXT PRIMARY KEY,client_id TEXT,
        exercise_key TEXT,data_json TEXT,deleted_at TEXT,updated_at TEXT);
      INSERT INTO clients VALUES ('synthetic-client-a'),('synthetic-client-b');
      INSERT INTO training_workouts VALUES ('synthetic-workout-a','synthetic-client-a'),
        ('synthetic-workout-b','synthetic-client-b');`);
    db.prepare("INSERT INTO exercise_catalog VALUES (?,?,?,?,?,?,?,?,?)").run(
      "synthetic-custom", "Своё упражнение", "Другое", "", '["Старое название"]', "user", timestamp, timestamp, null);
    db.prepare("INSERT INTO exercise_catalog VALUES (?,?,?,?,?,?,?,?,?)").run(
      "synthetic-stock", "Системное упражнение", "Спина", "Тренажёр", "[]", "stock", timestamp, timestamp, null);
    db.prepare("INSERT INTO training_exercises VALUES (?,?,?,?,?,?,?)").run(
      "synthetic-instance-a", "synthetic-workout-a", "Снимок названия", "synthetic-custom",
      '{"catalogId":"synthetic-custom"}', null, "Заметка в программе");
    db.prepare("INSERT INTO training_exercises VALUES (?,?,?,?,?,?,?)").run(
      "synthetic-instance-b", "synthetic-workout-b", "Снимок названия", "synthetic-custom",
      '{"catalogId":"synthetic-custom"}', null, "Другая заметка");
    db.prepare("INSERT INTO training_exercise_history VALUES (?,?,?,?,?,?)").run(
      "synthetic-history", "synthetic-client-a", "catalog:synthetic-custom",
      '{"catalogId":"synthetic-custom","exerciseId":"synthetic-instance-a","name":"Историческое название"}',
      null, timestamp);
    run(db);
  } finally { db.close(); }
}

function read(db: DatabaseSync) {
  db.exec("PRAGMA query_only = ON");
  db.exec("BEGIN");
  try {
    const catalog = readLegacyExerciseCatalogInSnapshot(db, scope);
    const refs = readLegacyExerciseReferencesInSnapshot(db, scope, catalog);
    return { catalog, refs, report: summarizeLegacyExercises(catalog, refs) };
  } finally { db.exec("ROLLBACK"); }
}

test("legacy custom draft retains identity, aliases and unspecified characteristics", () => fixture((db) => {
  const { catalog } = read(db);
  const custom = catalog.find((row) => row.origin === "CUSTOM")!;
  assert.equal(custom.sourceCatalogId, "synthetic-custom");
  assert.equal(custom.sourceIdentityKey, JSON.stringify([scope, "exercise_catalog", "synthetic-custom"]));
  assert.equal(custom.name, "Своё упражнение");
  assert.equal(custom.sourceCategory, "Другое");
  assert.equal(custom.bodyPart, null);
  assert.equal(custom.classification, "REQUIRES_CATEGORY_MAPPING");
  assert.equal(custom.equipment, null);
  assert.equal(custom.trackingProfile, "LOAD_REPS");
  assert.deepEqual(custom.aliases, ["Старое название"]);
  assert.equal(custom.raw.equipment, "");
  assert.equal(custom.targetExerciseId, null);
  assert.deepEqual(custom.issues, []);
}));

test("known equipment and legacy category survive without assigning RepDB identity", () => fixture((db) => {
  const { catalog } = read(db);
  const stock = catalog.find((row) => row.origin === "SYSTEM")!;
  assert.equal(stock.equipment, "Тренажёр");
  assert.equal(stock.sourceCategory, "Спина");
  assert.equal(stock.bodyPart, "back");
  assert.equal(stock.classification, "EXACT_CATEGORY");
  assert.equal(stock.targetExerciseId, null);
}));

test("deleted catalog and reference rows remain available for history and retain timestamps", () => fixture((db) => {
  db.prepare("UPDATE exercise_catalog SET deleted_at=? WHERE id='synthetic-custom'").run(timestamp);
  db.prepare("UPDATE training_exercises SET deleted_at=?").run(timestamp);
  db.prepare("UPDATE training_exercise_history SET deleted_at=?").run(timestamp);
  const { catalog, refs, report } = read(db);
  assert.equal(catalog.length, 2);
  assert.equal(catalog.find((row) => row.origin === "CUSTOM")?.lifecycle, "DELETED_SOURCE");
  assert.equal(refs.length, 3);
  assert.ok(refs.every((row) => row.raw.deleted_at === timestamp));
  assert.equal(report.linkedSourceRows, 3);
  assert.equal(report.deletedCatalogRows, 1);
}));

test("malformed aliases and unknown source remain unresolved instead of becoming empty/stock", () => fixture((db) => {
  db.exec("UPDATE exercise_catalog SET aliases_json='{broken',source='unrecognized' WHERE id='synthetic-custom'");
  const { catalog } = read(db);
  const custom = catalog.find((row) => row.sourceCatalogId === "synthetic-custom")!;
  assert.equal(custom.raw.aliases_json, "{broken");
  assert.equal(custom.aliases, null);
  assert.equal(custom.origin, null);
  assert.ok(custom.issues.includes("INVALID_ALIASES"));
  assert.ok(custom.issues.includes("UNKNOWN_SOURCE"));
}));

test("non-string aliases invalidate the whole list without silently dropping entries", () => fixture((db) => {
  db.exec("UPDATE exercise_catalog SET aliases_json='[\"Название\",7]' WHERE id='synthetic-custom'");
  assert.equal(read(db).catalog.find((row) => row.origin === "CUSTOM")?.aliases, null);
}));

test("invalid metadata remains in raw snapshot with explicit review reasons", () => fixture((db) => {
  db.exec("UPDATE exercise_catalog SET name='',category=NULL,equipment=NULL,created_at='',updated_at='bad',deleted_at='' WHERE id='synthetic-custom'");
  const custom = read(db).catalog.find((row) => row.origin === "CUSTOM")!;
  assert.equal(custom.lifecycle, "UNRESOLVED");
  assert.equal(custom.raw.deleted_at, "");
  assert.deepEqual(custom.issues, ["MISSING_NAME", "INVALID_CATEGORY", "INVALID_EQUIPMENT",
    "INVALID_CREATED_AT", "INVALID_UPDATED_AT", "INVALID_DELETED_AT"]);
}));

test("same names never merge independent source IDs or cause catalog matching", () => fixture((db) => {
  db.exec("UPDATE exercise_catalog SET name='Одинаковое название'");
  const { catalog } = read(db);
  assert.equal(catalog.length, 2);
  assert.notEqual(catalog[0]?.sourceIdentityKey, catalog[1]?.sourceIdentityKey);
}));

test("plan/history source links preserve separate instance IDs, names, notes and original JSON", () => fixture((db) => {
  const { refs } = read(db);
  assert.equal(refs.length, 3);
  assert.ok(refs.every((row) => row.sourceCatalogId === "synthetic-custom"));
  const instance = refs.find((row) => row.sourceRowId === "synthetic-instance-a")!;
  assert.equal(instance.raw.name, "Снимок названия");
  assert.equal(instance.raw.note, "Заметка в программе");
  const history = refs.find((row) => row.sourceTable === "training_exercise_history")!;
  assert.equal(history.raw.updated_at, timestamp);
  assert.match(String(history.raw.data_json), /Историческое название/u);
  assert.ok(refs.every((row) => row.targetExerciseId === null));
}));

test("conflicting column and JSON IDs do not choose the first catalog exercise", () => fixture((db) => {
  db.exec(`UPDATE training_exercises SET data_json='{"catalogId":"synthetic-stock"}' WHERE id='synthetic-instance-a'`);
  const { refs } = read(db);
  const instance = refs.find((row) => row.sourceRowId === "synthetic-instance-a")!;
  assert.equal(instance.sourceCatalogId, null);
  assert.ok(instance.issues.includes("CONFLICTING_CATALOG_REFERENCES"));
  assert.ok(refs.find((row) => row.sourceTable === "training_exercise_history")?.issues.includes("UNRESOLVED_INSTANCE"));
}));

test("history cannot borrow another client's instance even for the same catalog ID", () => fixture((db) => {
  db.exec(`UPDATE training_exercise_history SET data_json='{"catalogId":"synthetic-custom","exerciseId":"synthetic-instance-b"}'`);
  const { refs, report } = read(db);
  const history = refs.find((row) => row.sourceTable === "training_exercise_history")!;
  assert.equal(history.sourceCatalogId, null);
  assert.ok(history.issues.includes("FOREIGN_CLIENT_INSTANCE"));
  assert.equal(report.foreignClientReferenceRows, 1);
}));

test("history explicit ID and same-client instance must agree", () => fixture((db) => {
  db.exec("UPDATE training_exercise_history SET exercise_key='catalog:synthetic-stock'");
  const history = read(db).refs.find((row) => row.sourceTable === "training_exercise_history")!;
  assert.equal(history.sourceCatalogId, null);
  assert.ok(history.issues.includes("CONFLICTING_CATALOG_REFERENCES"));
}));

test("broken JSON is preserved; a valid column reference does not hide corruption", () => fixture((db) => {
  db.exec("UPDATE training_exercises SET data_json='{broken' WHERE id='synthetic-instance-a'");
  const instance = read(db).refs.find((row) => row.sourceRowId === "synthetic-instance-a")!;
  assert.equal(instance.sourceCatalogId, null);
  assert.equal(instance.raw.data_json, "{broken");
  assert.ok(instance.issues.includes("INVALID_JSON"));
}));

test("unknown IDs, missing owner and invalid references stay visible", () => fixture((db) => {
  db.exec(`UPDATE training_exercises SET workout_id='synthetic-missing',template_exercise_id='synthetic-unknown',data_json='{"catalogId":7}' WHERE id='synthetic-instance-a'`);
  const { refs } = read(db);
  assert.equal(refs.length, 3);
  const instance = refs.find((row) => row.sourceRowId === "synthetic-instance-a")!;
  assert.equal(instance.sourceCatalogId, null);
  assert.ok(instance.issues.includes("MISSING_OWNER"));
  assert.ok(instance.issues.includes("INVALID_CATALOG_REFERENCE"));
  assert.ok(instance.issues.includes("UNKNOWN_CATALOG_REFERENCE"));
}));

test("a historical name alone never matches a catalog exercise", () => fixture((db) => {
  db.exec(`UPDATE training_exercise_history SET exercise_key='Своё упражнение',data_json='{}'`);
  const history = read(db).refs.find((row) => row.sourceTable === "training_exercise_history")!;
  assert.equal(history.sourceCatalogId, null);
  assert.ok(history.issues.includes("MISSING_CATALOG_REFERENCE"));
}));

test("exact explicit legacy catalog ID is usable as source evidence without an instance", () => fixture((db) => {
  db.exec(`UPDATE training_exercise_history SET exercise_key='synthetic-custom',data_json='{"exerciseId":"synthetic-custom"}'`);
  const history = read(db).refs.find((row) => row.sourceTable === "training_exercise_history")!;
  assert.equal(history.sourceCatalogId, "synthetic-custom");
  assert.equal(history.status, "linked-source");
}));

test("source links reject foreign account catalogs and schema drift", () => fixture((db) => {
  const catalog = readLegacyExerciseCatalogInSnapshot(db, scope);
  assert.throws(() => readLegacyExerciseReferencesInSnapshot(db, "synthetic-other", catalog), /R04_EXERCISE_ACCOUNT_MISMATCH/u);
  assert.throws(() => readLegacyExerciseCatalogInSnapshot(db, " "), /R04_ACCOUNT_SCOPE_REQUIRED/u);
  db.exec("ALTER TABLE exercise_catalog RENAME COLUMN category TO category_changed");
  assert.throws(() => readLegacyExerciseCatalogInSnapshot(db, scope), /R04_EXERCISE_SHAPE_UNSUPPORTED/u);
}));

test("aggregate exercise report exposes counts only; all unresolved rows remain accounted for", () => fixture((db) => {
  const { report } = read(db);
  assert.deepEqual(report, {
    status: "requires-mapping", catalogRows: 2, customRows: 1, stockRows: 1, deletedCatalogRows: 0,
    invalidCatalogRows: 0, exactCategoryRows: 1, categoryMappingRequiredRows: 1, missingEquipmentRows: 1,
    exerciseReferenceRows: 2, historyReferenceRows: 1, linkedSourceRows: 3,
    unresolvedReferenceRows: 0, foreignClientReferenceRows: 0, targetMappedExercises: 0, targetWrites: 0,
  });
  assert.doesNotMatch(JSON.stringify(report), /synthetic|Своё|Системное|data_json|Заметка/u);
}));

test("duplicate physical catalog IDs block projection instead of overwriting a mapping", () => fixture((db) => {
  db.exec(`CREATE TABLE duplicate_catalog AS SELECT * FROM exercise_catalog;
    INSERT INTO duplicate_catalog SELECT * FROM exercise_catalog WHERE id='synthetic-custom';
    DROP TABLE exercise_catalog;
    ALTER TABLE duplicate_catalog RENAME TO exercise_catalog;`);
  assert.throws(() => readLegacyExerciseCatalogInSnapshot(db, scope), /R04_EXERCISE_CATALOG_IDENTITY_INVALID/u);
}));

test("duplicate physical exercise instances block links instead of silently replacing an owner", () => fixture((db) => {
  const catalog = readLegacyExerciseCatalogInSnapshot(db, scope);
  db.exec(`CREATE TABLE duplicate_exercises AS SELECT * FROM training_exercises;
    INSERT INTO duplicate_exercises SELECT * FROM training_exercises WHERE id='synthetic-instance-a';
    DROP TABLE training_exercises;
    ALTER TABLE duplicate_exercises RENAME TO training_exercises;`);
  assert.throws(() => readLegacyExerciseReferencesInSnapshot(db, scope, catalog), /R04_EXERCISE_REFERENCE_IDENTITY_INVALID/u);
}));

test("unambiguous legacy groups map to v3 categories without assigning detailed muscles", () => fixture((db) => {
  for (const [category, bodyPart] of [["Грудь", "chest"], ["Спина", "back"], ["Плечи", "shoulders"], ["Кор", "core"]]) {
    db.prepare("UPDATE exercise_catalog SET category=? WHERE id='synthetic-custom'").run(category!);
    const custom = readLegacyExerciseCatalogInSnapshot(db, scope).find((row) => row.origin === "CUSTOM")!;
    assert.equal(custom.bodyPart, bodyPart);
    assert.equal(custom.raw.category, category);
    assert.equal(custom.classification, "EXACT_CATEGORY");
  }
}));

test("broad, absent and arbitrary categories never guess a v3 muscle group", () => fixture((db) => {
  for (const category of ["Ноги", "Руки", "Кардио", "Другое", "", "Своя категория", "__proto__", "toString"]) {
    db.prepare("UPDATE exercise_catalog SET category=? WHERE id='synthetic-custom'").run(category);
    const custom = readLegacyExerciseCatalogInSnapshot(db, scope).find((row) => row.origin === "CUSTOM")!;
    assert.equal(custom.bodyPart, null);
    assert.equal(custom.classification, "REQUIRES_CATEGORY_MAPPING");
    assert.equal(custom.sourceCategory, category);
  }
}));
