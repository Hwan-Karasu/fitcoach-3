import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { convertLegacySetMetrics } from "./r04/LegacySetMetricCandidates.ts";
import { groupLegacyFactAtoms, readLegacyFactLedgerInSnapshot, summarizeLegacyFactLedger,
  type LegacyFactAtom } from "./r04/LegacyFactLedger.ts";
import type { LegacySetSource } from "./r04/SourceFactPreflight.ts";
import type { LegacyCurrentSetSource } from "./r04/LegacyCurrentSetSourceReader.ts";
import { readLegacyArchiveSetInventoryInSnapshot } from "./r04/LegacyArchiveSetInventory.ts";

const atom: LegacyFactAtom = {
  sourceKey: "synthetic-session", accountScope: "synthetic-scope", clientId: "synthetic-client",
  kind: "session", factId: "synthetic-fact", raw: { reps: "20", weight: "10" },
  metrics: convertLegacySetMetrics("20", "10"), warnings: [],
};
const session: LegacySetSource = {
  accountScope: "synthetic-scope", clientId: "synthetic-client", sourceRowId: "synthetic-set",
  sourceFactId: "synthetic-fact", programId: "synthetic-program", sessionId: "synthetic-session",
  sessionExerciseId: "synthetic-exercise", repsRaw: "20", weightRaw: "10",
  lifecycleShapeComplete: true, completedAtRaw: "2026-01-01T10:00:00Z",
};
const current: LegacyCurrentSetSource = {
  accountScope: "synthetic-scope", clientId: "synthetic-client", sourceRowId: "synthetic-current",
  sourceWorkoutId: "synthetic-workout", effectiveSourceFactId: "synthetic-fact", originStatus: "history-origin-id",
  lifecycleShapeComplete: true, setDeletedAtRaw: null, exerciseDeletedAtRaw: null,
  workoutDeletedAtRaw: null, completedAtRaw: "2026-01-01T10:00:00Z",
};

test("ledger partitions fact identity by both account and client", () => {
  const ledger = groupLegacyFactAtoms([atom, { ...atom, sourceKey: "other-client", clientId: "other" },
    { ...atom, sourceKey: "other-account", accountScope: "other" }]);
  assert.equal(ledger.groups.length, 3);
  assert.ok(ledger.groups.every((group) => group.atoms.length === 1));
});

test("equal metrics without source identity never manufacture or merge a logical fact", () => {
  const ledger = groupLegacyFactAtoms([{ ...atom, factId: null }, { ...atom, sourceKey: "other", factId: null }]);
  assert.equal(ledger.groups.length, 0);
  assert.equal(ledger.unresolved.length, 2);
});

test("cross-source matching values group evidence without creating target identity", () => {
  const ledger = groupLegacyFactAtoms([atom, { ...atom, sourceKey: "history", kind: "history", warnings: ["HISTORY_NOT_PERFORMED_PROOF"] }]);
  assert.equal(ledger.groups.length, 1);
  assert.equal(ledger.groups[0]?.status, "REQUIRES_REVIEW");
  assert.equal(ledger.groups[0]?.targetFactId, null);
  assert.equal(ledger.groups[0]?.atoms.length, 2);
});

test("different metrics in the same identity are a conflict regardless of source priority", () => {
  const other: LegacyFactAtom = { ...atom, sourceKey: "history", kind: "history", metrics: convertLegacySetMetrics("20", "12") };
  for (const atoms of [[atom, other], [other, atom]]) {
    assert.equal(groupLegacyFactAtoms(atoms).groups[0]?.status, "METRIC_CONFLICT");
  }
});

test("decimal notation is normalized exactly; missing values never become zero", () => {
  const left = { ...atom, metrics: convertLegacySetMetrics("20", "2,125") };
  const right = { ...atom, sourceKey: "other", metrics: convertLegacySetMetrics("20", "2.1250") };
  assert.equal(groupLegacyFactAtoms([left, right]).groups[0]?.status, "CONSISTENT_METRICS");
  assert.equal(groupLegacyFactAtoms([atom, { ...right, metrics: convertLegacySetMetrics("20", "") }]).groups[0]?.status, "REQUIRES_REVIEW");
});

test("duplicate physical source identity is rejected instead of overwriting evidence", () => {
  assert.throws(() => groupLegacyFactAtoms([atom, atom]), /R04_FACT_LEDGER_PROVENANCE_INVALID/u);
  assert.throws(() => groupLegacyFactAtoms([{ ...atom, clientId: "" }]), /R04_FACT_LEDGER_PROVENANCE_INVALID/u);
});

function fixture(run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY);
      INSERT INTO clients VALUES ('synthetic-client');
      CREATE TABLE training_session_sets(id TEXT PRIMARY KEY,reps TEXT,weight TEXT);
      INSERT INTO training_session_sets VALUES ('synthetic-set','20','10');
      CREATE TABLE training_set_logs(id TEXT PRIMARY KEY,reps TEXT,weight TEXT,data_json TEXT);
      INSERT INTO training_set_logs VALUES ('synthetic-current','20','10','{"historyOriginId":"synthetic-fact"}');
      CREATE TABLE training_exercise_history(id TEXT PRIMARY KEY,data_json TEXT);
      INSERT INTO training_exercise_history VALUES ('synthetic-history','{"reps":"20","weight":"10","rpe":"8","date":"legacy-date"}');
      CREATE TABLE training_archive_entries(id TEXT PRIMARY KEY,client_id TEXT,data_json TEXT);`);
    const workouts = [{ exercises: [{ sets: [{ sourceFactId: "synthetic-fact", reps: "20", weight: "10", data: {} }] }] }];
    db.prepare("INSERT INTO training_archive_entries VALUES (?,?,?)").run("synthetic-archive", "synthetic-client",
      JSON.stringify({ workouts, cycles: [{ snapshot: { workouts } }] }));
    run(db);
  } finally { db.close(); }
}
function evidence(db: DatabaseSync) {
  return { sets: [session], currentSets: [current], history: [{ accountScope: "synthetic-scope",
    sourceRowId: "synthetic-history", clientId: "synthetic-client", sourceFactId: "synthetic-fact" }],
  archiveSetInventory: readLegacyArchiveSetInventoryInSnapshot(db, "synthetic-scope") };
}

test("all four representations and archive mirrors reconcile to one source group, retaining all raw atoms", () => fixture((db) => {
  const ledger = readLegacyFactLedgerInSnapshot(db, "synthetic-scope", evidence(db));
  assert.equal(ledger.atoms.length, 5);
  assert.equal(ledger.groups.length, 1);
  assert.equal(ledger.groups[0]?.atoms.length, 5);
  assert.equal(ledger.unresolved.length, 0);
  const history = ledger.atoms.find((entry) => entry.kind === "history")!;
  assert.match(String((history.raw as Record<string, unknown>).data_json), /legacy-date/u);
  const report = summarizeLegacyFactLedger(ledger);
  assert.equal(report.crossSourceGroups, 1);
  assert.equal(report.archiveAtoms, 2);
  assert.equal(report.sessionAtoms + report.currentAtoms + report.historyAtoms + report.archiveAtoms, report.physicalAtoms);
  assert.equal(report.targetFactsCreated, 0);
  assert.doesNotMatch(JSON.stringify(report), /synthetic|reps|weight|legacy-date|sourceKey/u);
}));

test("unreadable history metrics do not silently inherit session values", () => fixture((db) => {
  db.exec("UPDATE training_exercise_history SET data_json='{broken'");
  const ledger = readLegacyFactLedgerInSnapshot(db, "synthetic-scope", evidence(db));
  const history = ledger.atoms.find((entry) => entry.kind === "history")!;
  assert.equal(history.metrics.values.reps, null);
  assert.ok(history.warnings.includes("HISTORY_PAYLOAD_UNREADABLE_OR_UNOBSERVED"));
  assert.equal(ledger.groups[0]?.status, "REQUIRES_REVIEW");
}));

test("file/snapshot evidence coverage mismatch is rejected before returning a ledger", () => fixture((db) => {
  const source = evidence(db);
  assert.throws(() => readLegacyFactLedgerInSnapshot(db, "synthetic-scope", { ...source, sets: [] }), /R04_FACT_LEDGER_COVERAGE_MISMATCH/u);
  assert.throws(() => readLegacyFactLedgerInSnapshot(db, "other", source), /R04_FACT_LEDGER_SCOPE_MISMATCH/u);
}));

test("deletion and absent completion markers remain review reasons rather than deleting results", () => fixture((db) => {
  const source = evidence(db);
  const ledger = readLegacyFactLedgerInSnapshot(db, "synthetic-scope", { ...source,
    sets: [{ ...session, completedAtRaw: null, setDeletedAtRaw: "legacy-marker" }] });
  const entry = ledger.atoms.find((entry) => entry.kind === "session")!;
  assert.ok(entry.warnings.includes("DELETION_REQUIRES_REVIEW"));
  assert.ok(entry.warnings.includes("COMPLETION_UNPROVEN"));
  assert.equal(ledger.atoms.length, 5);
}));
