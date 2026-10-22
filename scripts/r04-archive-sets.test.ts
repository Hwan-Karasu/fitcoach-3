import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readLegacyArchiveSetInventoryInSnapshot, summarizeLegacyArchiveSets } from "./r04/LegacyArchiveSetInventory.ts";
import type { LegacySetSource } from "./r04/SourceFactPreflight.ts";

const set = { sourceFactId: "synthetic-fact", reps: "20", weight: "10", completedAt: null,
  data: { historyOriginId: "synthetic-fact", factCompletionExplicit: true } };
const snapshot = (sets: readonly unknown[]) => ({ workouts: [{ name: "Снимок занятия",
  exercises: [{ name: "Снимок упражнения", note: "Заметка", sets }] }], weeks: [] });
const session: LegacySetSource = {
  accountScope: "synthetic-scope", sourceRowId: "synthetic-session-set", clientId: "synthetic-client",
  programId: "synthetic-program", sessionId: "synthetic-session", sessionExerciseId: "synthetic-exercise",
  sourceFactId: "synthetic-fact", repsRaw: "20", weightRaw: "10",
};

function fixture(value: unknown, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      INSERT INTO clients VALUES ('synthetic-client'),('synthetic-other');
      CREATE TABLE training_archive_entries (id TEXT PRIMARY KEY,client_id TEXT,data_json TEXT,deleted_at TEXT,title TEXT);`);
    db.prepare("INSERT INTO training_archive_entries VALUES (?,?,?,?,?)").run(
      "synthetic-archive", "synthetic-client", JSON.stringify(value), null, "Архивное название");
    run(db);
  } finally { db.close(); }
}
const read = (db: DatabaseSync) => readLegacyArchiveSetInventoryInSnapshot(db, "synthetic-scope");

test("archive root and cycle mirrors are separate physical occurrences, never two new facts", () => {
  const payload = { ...snapshot([set]), cycles: [{ name: "Мезоцикл", snapshot: snapshot([set]) }] };
  fixture(payload, (db) => {
    const inventory = read(db), report = summarizeLegacyArchiveSets(inventory, [session]);
    assert.equal(report.physicalSetOccurrences, 2);
    assert.equal(report.rootSetOccurrences, 1);
    assert.equal(report.cycleSetOccurrences, 1);
    assert.equal(report.repeatedIdOccurrences, 2);
    assert.equal(report.rootCycleOverlapGroups, 1);
    assert.equal(report.sameClientSessionLinkedOccurrences, 2);
    assert.equal(report.targetFactsCreated, 0);
    const occurrences = inventory[0]!.occurrences;
    assert.notEqual(occurrences[0]?.sourceIdentityKey, occurrences[1]?.sourceIdentityKey);
    assert.equal(inventory[0]?.raw.data_json, JSON.stringify(payload));
    assert.equal(occurrences[0]?.metrics.values.loadGrams, 10000);
  });
});

test("matching fact ID with conflicting archive/session metrics stays visible for review", () => fixture({
  ...snapshot([set]), cycles: [{ snapshot: snapshot([{ ...set, weight: "12" }]) }],
}, (db) => {
  const report = summarizeLegacyArchiveSets(read(db), [session]);
  assert.equal(report.conflictingMetricGroups, 1);
  assert.equal(report.sessionMetricConflictOccurrences, 1);
  assert.equal(report.targetWrites, 0);
}));

test("source IDs never borrow another client's session even with identical metrics", () => fixture(snapshot([set]), (db) => {
  const report = summarizeLegacyArchiveSets(read(db), [{ ...session, clientId: "synthetic-other" }]);
  assert.equal(report.sameClientSessionLinkedOccurrences, 0);
  assert.equal(report.physicalSetOccurrences, 1);
}));

test("missing or conflicting source fact identity never becomes an array-index fact ID", () => fixture(snapshot([
  { reps: "10", weight: "20" }, { ...set, sourceFactId: "synthetic-conflict" },
  { ...set, sourceFactId: 42 }, { ...set, data: null }, null,
]), (db) => {
  const occurrences = read(db)[0]!.occurrences;
  assert.equal(occurrences.length, 5);
  assert.ok(occurrences.every((row) => row.sourceFactId === null));
  assert.deepEqual(occurrences.map((row) => row.identityIssue), [
    "MISSING_SOURCE_FACT_ID", "CONFLICTING_SOURCE_FACT_IDS", "INVALID_SOURCE_FACT_ID", "INVALID_SET_DATA", "INVALID_SET",
  ]);
  assert.ok(occurrences.every((row) => row.targetFactId === null));
}));

test("history origin alone is retained without inventing completion or date", () => fixture(snapshot([
  { reps: "10", weight: "0", data: { historyOriginId: "synthetic-origin" } },
]), (db) => {
  const occurrence = read(db)[0]!.occurrences[0]!;
  assert.equal(occurrence.sourceFactId, "synthetic-origin");
  assert.equal(occurrence.metrics.values.loadGrams, 0);
  assert.equal(Object.hasOwn(occurrence, "confirmed"), false);
  assert.equal(Object.hasOwn(occurrence, "completedAt"), false);
}));

test("segments, effort, completion and raw metrics survive without making mini-sets separate facts", () => {
  const original = { ...set, weight: "2,125", rpe: "8", setKind: "drop", effortOutcome: "failure",
    completedAt: "2026-01-01T10:00:00Z", segments: [{ id: "synthetic-segment", reps: "5", weight: "1" }] };
  fixture(snapshot([original]), (db) => {
    const occurrence = read(db)[0]!.occurrences[0]!;
    assert.deepEqual(occurrence.raw, original);
    assert.equal(occurrence.metrics.values.loadGrams, 2125);
    assert.equal(summarizeLegacyArchiveSets(read(db), []).physicalSetOccurrences, 1);
  });
});

test("incomplete and invalid metrics retain source values without default zero or rounding", () => fixture(snapshot([
  { ...set, reps: "", weight: "1.0001" }, { ...set, reps: 20, weight: null },
]), (db) => {
  const inventory = read(db);
  assert.equal(summarizeLegacyArchiveSets(inventory, []).invalidMetricOccurrences, 2);
  assert.equal(inventory[0]!.occurrences[0]?.metrics.values.loadGrams, null);
  assert.equal(inventory[0]!.occurrences[1]?.metrics.values.reps, null);
}));

test("old archive without workout payload is distinguished from an explicitly empty array", () => fixture({ weeks: [] }, (db) => {
  assert.deepEqual(read(db)[0]?.issues, [{ path: "/workouts", code: "WORKOUTS_NOT_OBSERVED" }]);
  db.prepare("UPDATE training_archive_entries SET data_json=?").run(JSON.stringify(snapshot([])));
  assert.deepEqual(read(db)[0]?.issues, []);
  assert.equal(read(db)[0]?.occurrences.length, 0);
}));

test("malformed nested arrays and elements are recorded at their exact source paths", () => fixture({
  workouts: [null, { exercises: null }, { exercises: [null, { sets: null }] }], cycles: [null, { snapshot: null }],
}, (db) => {
  const issues = read(db)[0]!.issues;
  assert.ok(issues.some((issue) => issue.path === "/workouts/0" && issue.code === "INVALID_WORKOUT"));
  assert.ok(issues.some((issue) => issue.code === "INVALID_EXERCISES"));
  assert.ok(issues.some((issue) => issue.code === "INVALID_EXERCISE"));
  assert.ok(issues.some((issue) => issue.code === "INVALID_SETS"));
  assert.ok(issues.some((issue) => issue.code === "INVALID_CYCLE"));
  assert.ok(issues.some((issue) => issue.path === "/cycles/1/snapshot" && issue.code === "INVALID_SNAPSHOT"));
}));

test("invalid archive JSON and deletion marker remain byte-exact in the inventory", () => fixture({}, (db) => {
  db.exec("UPDATE training_archive_entries SET data_json='{broken',deleted_at='legacy-marker'");
  const inventory = read(db);
  assert.equal(inventory[0]?.raw.data_json, "{broken");
  assert.equal(inventory[0]?.raw.deleted_at, "legacy-marker");
  assert.equal(inventory[0]?.issues[0]?.code, "INVALID_JSON");
}));

test("root/cycle occurrences in different archive rows are not asserted to be one mirrored snapshot", () => fixture(snapshot([set]), (db) => {
  db.prepare("INSERT INTO training_archive_entries VALUES (?,?,?,?,?)").run(
    "synthetic-second", "synthetic-client", JSON.stringify({ cycles: [{ snapshot: snapshot([set]) }] }), null, "Второй архив");
  const report = summarizeLegacyArchiveSets(read(db), []);
  assert.equal(report.physicalSetOccurrences, 2);
  assert.equal(report.repeatedIdOccurrences, 2);
  assert.equal(report.rootCycleOverlapGroups, 0);
}));

test("missing client owner is visible and mixed account scope is rejected", () => fixture(snapshot([set]), (db) => {
  db.exec("UPDATE training_archive_entries SET client_id='synthetic-missing'");
  const inventory = read(db);
  assert.equal(summarizeLegacyArchiveSets(inventory, []).missingOwnerRows, 1);
  assert.throws(() => summarizeLegacyArchiveSets(inventory, [{ ...session, accountScope: "synthetic-other-scope" }]), /R04_ARCHIVE_PAYLOAD_SCOPE_MISMATCH/u);
}));

test("duplicate physical archive IDs and unsupported columns block the inventory", () => fixture({}, (db) => {
  db.exec(`CREATE TABLE duplicate_archives AS SELECT * FROM training_archive_entries;
    INSERT INTO duplicate_archives SELECT * FROM training_archive_entries;
    DROP TABLE training_archive_entries; ALTER TABLE duplicate_archives RENAME TO training_archive_entries;`);
  assert.throws(() => read(db), /R04_ARCHIVE_PAYLOAD_IDENTITY_INVALID/u);
  db.exec("ALTER TABLE training_archive_entries RENAME COLUMN data_json TO unknown_payload");
  assert.throws(() => read(db), /R04_ARCHIVE_PAYLOAD_SHAPE_UNSUPPORTED/u);
}));

test("safe aggregate contains only counts and fixed status, without IDs or payload", () => fixture(snapshot([set]), (db) => {
  const report = summarizeLegacyArchiveSets(read(db), [session]);
  assert.equal(report.rootSetOccurrences + report.cycleSetOccurrences, report.physicalSetOccurrences);
  assert.doesNotMatch(JSON.stringify(report), /synthetic|Снимок|Заметка|sourceFactId|reps|weight/u);
  assert.equal(report.targetFactsCreated, 0);
  assert.throws(() => readLegacyArchiveSetInventoryInSnapshot(db, " "), /R04_ACCOUNT_SCOPE_REQUIRED/u);
}));
