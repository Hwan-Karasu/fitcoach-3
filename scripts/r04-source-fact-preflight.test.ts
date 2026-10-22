import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createSyntheticLegacyFixture, fixtureRows } from "./r03/SyntheticLegacyFixture.ts";
import { auditR04FullCopy } from "./r04/AuditR04FullCopy.ts";
import { auditSourceFactCopy, hasSingleAuditCopyArgument } from "./r04/AuditSourceFactCopy.ts";
import { auditLegacyTableCoverageFile } from "./r04/AuditLegacyTableCoverage.ts";
import { summarizeArchiveSource } from "./r04/ArchiveSourcePreflightReport.ts";
import { summarizeCalendarSource } from "./r04/CalendarSourcePreflightReport.ts";
import { summarizeClientDaySource } from "./r04/ClientDaySourcePreflightReport.ts";
import { triangulateUnpairedCompletedCurrentSets } from "./r04/CurrentHistoryTriangulation.ts";
import { exactNonnegativeHundredth } from "./r04/ExactScaledHundredth.ts";
import { summarizeCurrentSetLinks } from "./r04/CurrentSetLinkPreflightReport.ts";
import { preflightHistoryLinks, type LegacyHistorySource } from "./r04/HistoryLinkPreflight.ts";
import { summarizeHistoryLinks } from "./r04/HistoryLinkPreflightReport.ts";
import { readLegacyEvidence } from "./r04/LegacyEvidenceReader.ts";
import { readLegacyArchiveRowsInSnapshot } from "./r04/LegacyArchiveSourceReader.ts";
import { readLegacyCalendarRowsInSnapshot } from "./r04/LegacyCalendarSourceReader.ts";
import { readLegacyClientDayRowsInSnapshot } from "./r04/LegacyClientDaySourceReader.ts";
import { readLegacyClientIdentityInSnapshot,
  summarizeLegacyClientIdentity } from "./r04/LegacyClientIdentitySourceReader.ts";
import { inventoryLegacyClientReferencesInSnapshot } from "./r04/LegacyClientReferenceInventory.ts";
import { readLegacyCurrentSetRowsInSnapshot, type LegacyCurrentSetSource } from "./r04/LegacyCurrentSetSourceReader.ts";
import { readLegacyWorkoutSnapshotRowsInSnapshot,
  type LegacyWorkoutSnapshotSource } from "./r04/LegacyWorkoutSnapshotSourceReader.ts";
import { readLegacyHistoryRows } from "./r04/LegacyHistorySourceReader.ts";
import { readLegacyMeasurementRowsInSnapshot } from "./r04/LegacyMeasurementSourceReader.ts";
import { readLegacyProgramBooksInSnapshot } from "./r04/LegacyProgramBookSourceReader.ts";
import { buildDailyWeightCandidates, readLegacyProfileWeightsInSnapshot,
  reconcileLegacyWeightSources } from "./r04/LegacyWeightSourceReconciliation.ts";
import { readLegacyNutritionDayRowsInSnapshot } from "./r04/LegacyNutritionDaySourceReader.ts";
import { readLegacyNutritionEntryEvidenceInSnapshot } from "./r04/LegacyNutritionEntrySourceReader.ts";
import { readLegacySetRows, readLegacySetRowsInSnapshot } from "./r04/LegacySetSourceReader.ts";
import { summarizeLegacyRowInventory } from "./r04/LegacyRowInventory.ts";
import { summarizeLegacySourceIdentity } from "./r04/LegacySourceIdentity.ts";
import { summarizeMeasurementSource } from "./r04/MeasurementSourcePreflightReport.ts";
import { buildMeasurementValueCandidates,
  summarizeMeasurementValueCandidates } from "./r04/MeasurementValueCandidates.ts";
import { summarizeNutritionSource } from "./r04/NutritionSourcePreflightReport.ts";
import { summarizeProgramBooks } from "./r04/ProgramBookPreflightReport.ts";
import { preflightProgramLinksInSnapshot } from "./r04/ProgramLinkPreflight.ts";
import { projectClientIdentityDrafts } from "./r04/ProjectClientIdentityDraft.ts";
import { readSessionProgramLinkCandidatesInSnapshot,
  summarizeSessionProgramLinkCandidates } from "./r04/SessionProgramLinkCandidates.ts";
import { triangulateSessionWorkoutOriginsInSnapshot } from "./r04/SessionWorkoutOriginTriangulation.ts";
import { summarizeNutritionEntryIdentity } from "./r04/NutritionEntryIdentityReport.ts";
import { auditLegacyTableCoverage, computeLegacyColumnShapeDigest, computeLegacySchemaDigest,
  observedBuild120Tables } from "./r04/LegacyTableCoverage.ts";
import { preflightSourceFacts, type LegacySetSource } from "./r04/SourceFactPreflight.ts";
import { summarizeSourceFactPreflight } from "./r04/SourceFactPreflightReport.ts";

const base: LegacySetSource = {
  accountScope: "synthetic-account-scope",
  sourceRowId: "synthetic-row-1",
  clientId: "synthetic-client-a",
  programId: "synthetic-program-a",
  sessionId: "synthetic-session-a",
  sessionExerciseId: "synthetic-exercise-a",
  sourceFactId: "synthetic-fact-1",
  repsRaw: "10",
  weightRaw: "20",
};

const historyBase: LegacyHistorySource = {
  accountScope: "synthetic-account-scope",
  sourceRowId: "synthetic-history-1",
  clientId: "synthetic-client-a",
  sourceFactId: "synthetic-fact-1",
};

const currentBase: LegacyCurrentSetSource = {
  accountScope: "synthetic-account-scope",
  sourceRowId: "synthetic-current-1",
  clientId: "synthetic-client-a",
  sourceWorkoutId: "synthetic-planned-workout-a",
  effectiveSourceFactId: "synthetic-fact-1",
  originStatus: "history-origin-id",
  lifecycleShapeComplete: true,
  setDeletedAtRaw: null,
  exerciseDeletedAtRaw: null,
  workoutDeletedAtRaw: null,
  completedAtRaw: "2026-01-03",
};

test("R04 preflight retains every physical legacy row; even singleton rows are unverified", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const rows = readLegacySetRows(db, "synthetic-account-scope");
    const candidates = preflightSourceFacts(rows);
    assert.equal(candidates.length, rows.length);
    assert.equal(new Set(candidates.map((item) => item.source.sourceRowId)).size, rows.length);
    assert.ok(candidates.every((item) => item.disposition === "BLOCKED_PENDING_SEMANTIC_REVIEW"));
    assert.ok(candidates.every((item) => item.reviewReasons.includes("SOURCE_FACTS_UNVERIFIED")));
    assert.equal(candidates.filter((item) => item.reviewReasons.includes("REPEATED_SOURCE_FACT_ID")).length, 4);
    assert.equal(candidates.filter((item) => item.reviewReasons.includes("METRIC_CONFLICT")).length, 2);
    assert.equal(candidates.filter((item) => item.reviewReasons.includes("CROSS_CLIENT_SOURCE_FACT_ID")).length, 0);
  } finally { db.close(); }
});

test("R04 preflight never deduplicates equal metrics across sessions or programs", () => {
  const rows = [base, {
    ...base, sourceRowId: "synthetic-row-2", sessionId: "synthetic-session-2",
    sessionExerciseId: "synthetic-exercise-2", programId: "synthetic-program-2",
  }];
  const candidates = preflightSourceFacts(rows);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((item) => item.source.sourceRowId), ["synthetic-row-1", "synthetic-row-2"]);
  assert.ok(candidates.every((item) => item.reviewReasons.includes("REPEATED_SOURCE_FACT_ID")));
  assert.ok(candidates.every((item) => item.reviewReasons.includes("CROSS_SESSION_SOURCE_FACT_ID")));
  assert.ok(candidates.every((item) => item.reviewReasons.includes("CROSS_PROGRAM_SOURCE_FACT_ID")));
  assert.ok(candidates.every((item) => !item.reviewReasons.includes("METRIC_CONFLICT")));
});

test("R04 preflight flags cross-client reuse within an account but keeps accounts separate", () => {
  const rows: LegacySetSource[] = [base, {
    ...base, sourceRowId: "synthetic-row-2", clientId: "synthetic-client-b",
    sessionId: "synthetic-session-b", sessionExerciseId: "synthetic-exercise-b",
  }, {
    ...base, accountScope: "synthetic-second-account",
  }];
  const candidates = preflightSourceFacts(rows);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.slice(0, 2).every((item) => item.reviewReasons.includes("CROSS_CLIENT_SOURCE_FACT_ID")));
  assert.ok(!candidates[2]?.reviewReasons.includes("REPEATED_SOURCE_FACT_ID"));
});

test("R04 preflight preserves unknown metrics and empty fact ID instead of inventing zero", () => {
  const [candidate] = preflightSourceFacts([{ ...base, sourceFactId: "", repsRaw: null, weightRaw: "" }]);
  assert.ok(candidate);
  assert.ok(candidate.reviewReasons.includes("EMPTY_SOURCE_FACT_ID"));
  assert.ok(candidate.reviewReasons.includes("MISSING_METRIC"));
  assert.equal(candidate.source.repsRaw, null);
  assert.equal(candidate.source.weightRaw, "");
});

test("R04 metric comparison does not collapse null into an empty string", () => {
  const rows: LegacySetSource[] = [
    { ...base, repsRaw: null },
    { ...base, sourceRowId: "synthetic-row-2", sessionExerciseId: "synthetic-exercise-2", repsRaw: "" },
  ];
  const candidates = preflightSourceFacts(rows);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((item) => item.reviewReasons.includes("MISSING_METRIC")));
  assert.ok(candidates.every((item) => item.reviewReasons.includes("METRIC_CONFLICT")));
  assert.equal(candidates[0]?.source.repsRaw, null);
  assert.equal(candidates[1]?.source.repsRaw, "");
});

test("R04 lifecycle markers are review signals, never proof of a performed set", () => {
  const [candidate] = preflightSourceFacts([{
    ...base,
    lifecycleShapeComplete: true,
    setDeletedAtRaw: "2026-01-03",
    sessionDeletedAtRaw: "2026-01-04",
    exerciseDeletedAtRaw: "2026-01-05",
    completedAtRaw: null,
    performedAtRaw: null,
  }]);
  assert.ok(candidate);
  assert.equal(candidate.disposition, "BLOCKED_PENDING_SEMANTIC_REVIEW");
  for (const reason of [
    "SET_DELETION_MARKER_PRESENT", "SESSION_DELETION_MARKER_PRESENT",
    "EXERCISE_DELETION_MARKER_PRESENT", "SET_COMPLETION_MARKER_MISSING",
    "SESSION_PERFORMANCE_TIME_MISSING", "ANY_DELETION_MARKER_PRESENT",
  ]) assert.ok(candidate.reviewReasons.includes(reason as typeof candidate.reviewReasons[number]));
  const report = summarizeSourceFactPreflight([candidate.source]);
  assert.equal(report.reasonRowCounts.SET_DELETION_MARKER_PRESENT, 1);
  assert.equal(report.reasonRowCounts.SESSION_DELETION_MARKER_PRESENT, 1);
  assert.equal(report.reasonRowCounts.EXERCISE_DELETION_MARKER_PRESENT, 1);
  assert.equal(report.reasonRowCounts.ANY_DELETION_MARKER_PRESENT, 1);
});

test("R04 missing lifecycle columns are visible instead of invented as empty values", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const rows = readLegacySetRows(db, "synthetic-account-scope");
    assert.ok(rows.every((row) => row.lifecycleShapeComplete === false));
    const report = summarizeSourceFactPreflight(rows);
    assert.equal(report.reasonRowCounts.LIFECYCLE_COLUMNS_MISSING, rows.length);
    assert.equal(report.reasonRowCounts.SET_COMPLETION_MARKER_MISSING, 0);
  } finally { db.close(); }
});

test("R04 preflight rejects missing provenance and duplicate physical identity", () => {
  assert.throws(() => preflightSourceFacts([{ ...base, sessionId: "" }]),
    { message: "R04_SOURCE_PROVENANCE_INCOMPLETE" });
  assert.throws(() => preflightSourceFacts([base, { ...base, sourceFactId: "another-fact" }]),
    { message: "R04_DUPLICATE_PHYSICAL_ROW_ID" });
});

test("R04 reader does not hide an orphan physical row behind an inner join", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("INSERT INTO training_session_sets VALUES (?, ?, ?, ?, ?)")
      .run("synthetic-orphan-set", "synthetic-missing-exercise", "synthetic-orphan-fact", "10", "20");
    assert.throws(() => readLegacySetRows(db, "synthetic-account-scope"),
      { message: "R04_SOURCE_PROVENANCE_INCOMPLETE" });
    db.exec("BEGIN");
    db.exec("ROLLBACK");
  } finally { db.close(); }
});

test("R04 reader rejects unsupported schema and missing account scope", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(() => readLegacySetRows(db, ""), { message: "R04_ACCOUNT_SCOPE_REQUIRED" });
    assert.throws(() => readLegacySetRows(db, "synthetic-account-scope"),
      { message: "R04_SOURCE_SHAPE_UNSUPPORTED" });
  } finally { db.close(); }
});

test("R04 aggregate report counts physical rows only and never returns source identity", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const report = summarizeSourceFactPreflight(readLegacySetRows(db, "synthetic-account-scope"));
    assert.equal(report.status, "requires-semantic-review");
    assert.equal(report.sourceRows, 6);
    assert.equal(report.blockedCandidateRows, 6);
    assert.equal(report.targetWrites, 0);
    assert.equal(report.reasonRowCounts.REPEATED_SOURCE_FACT_ID, 4);
    assert.equal(report.reasonRowCounts.METRIC_CONFLICT, 2);
    assert.equal(report.reasonRowCounts.SOURCE_FACTS_UNVERIFIED, 6);
    assert.ok(!JSON.stringify(report).includes("synthetic-client-a"));
    assert.ok(!JSON.stringify(report).includes("synthetic-fact-a"));
  } finally { db.close(); }
});

test("R04 empty source is still review-required, not a verified migration", () => {
  const report = summarizeSourceFactPreflight([]);
  assert.equal(report.status, "requires-semantic-review");
  assert.equal(report.sourceRows, 0);
  assert.equal(report.targetWrites, 0);
});

function withSyntheticCopy(mutate: (db: DatabaseSync) => void, inspect: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "fitcoach-r04-copy-"));
  const path = join(directory, "synthetic.atbackup");
  try {
    const db = createSyntheticLegacyFixture(path);
    try { mutate(db); } finally { db.close(); }
    inspect(path);
  } finally {
    rmSync(path, { force: true });
    rmdirSync(directory);
  }
}

test("R04 file audit preserves source bytes and returns only aggregate counts", () => {
  withSyntheticCopy(() => {}, (path) => {
    const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
    const before = hash();
    const report = auditSourceFactCopy(path);
    assert.equal(report.status, "requires-semantic-review");
    assert.equal(hash(), before);
    assert.ok(!JSON.stringify(report).includes("synthetic-client-a"));
    if (report.status === "requires-semantic-review") {
      assert.equal(report.sourceRows, 6);
      assert.equal(report.history.historyRows, 1);
      assert.equal(report.history.reasonRowCounts.MULTIPLE_SAME_CLIENT_SETS, 1);
    }
  });
});

test("R04 file audit blocks unsupported set schema without printing source rows", () => {
  withSyntheticCopy((db) => { db.exec("DROP TABLE training_session_sets"); }, (path) => {
    const report = auditSourceFactCopy(path);
    assert.deepEqual(report, { status: "blocked", reasons: ["R04_SOURCE_SHAPE_UNSUPPORTED"] });
    assert.ok(!JSON.stringify(report).includes("synthetic-client-a"));
  });
});

test("R04 file audit requires one explicit .atbackup argument", () => {
  assert.equal(hasSingleAuditCopyArgument([]), false);
  assert.equal(hasSingleAuditCopyArgument(["copy.atbackup", "other.atbackup"]), false);
  assert.equal(hasSingleAuditCopyArgument(["copy.sqlite"]), false);
  assert.equal(hasSingleAuditCopyArgument(["copy.atbackup"]), true);
});

test("R04 history preflight treats one reference as unverified, not as a performed set", () => {
  const [candidate] = preflightHistoryLinks([historyBase], [base]);
  assert.ok(candidate);
  assert.equal(candidate.disposition, "BLOCKED_PENDING_SEMANTIC_REVIEW");
  assert.ok(candidate.reviewReasons.includes("SINGLE_REFERENCE_NOT_PROOF"));
  assert.ok(candidate.reviewReasons.includes("HISTORY_ROW_UNVERIFIED"));
});

test("R04 history deletion marker remains a review signal, not a set", () => {
  const [candidate] = preflightHistoryLinks([{
    ...historyBase, deletedAtRaw: "2026-01-04", lifecycleShapeComplete: true,
  }], [base]);
  assert.ok(candidate);
  assert.ok(candidate.reviewReasons.includes("HISTORY_DELETION_MARKER_PRESENT"));
  assert.equal(candidate.disposition, "BLOCKED_PENDING_SEMANTIC_REVIEW");
  const report = summarizeHistoryLinks([candidate.source], [base]);
  assert.equal(report.historyRows, 1);
  assert.equal(report.reasonRowCounts.HISTORY_DELETION_MARKER_PRESENT, 1);
  assert.equal(report.deletionMarkerLinkCounts.singleReferenceNotProof, 1);
});

test("R04 deleted history links partition into disjoint no/single/multiple classes", () => {
  const deletedAtRaw = "2026-01-04";
  const history: LegacyHistorySource[] = [
    { ...historyBase, sourceRowId: "synthetic-history-no", sourceFactId: "synthetic-missing", deletedAtRaw },
    { ...historyBase, sourceRowId: "synthetic-history-one", deletedAtRaw },
    { ...historyBase, sourceRowId: "synthetic-history-many", sourceFactId: "synthetic-many", deletedAtRaw },
  ];
  const sets: LegacySetSource[] = [base,
    { ...base, sourceRowId: "synthetic-many-a", sourceFactId: "synthetic-many" },
    { ...base, sourceRowId: "synthetic-many-b", sourceFactId: "synthetic-many" }];
  const report = summarizeHistoryLinks(history, sets);
  assert.deepEqual(report.deletionMarkerLinkCounts, {
    noSameClientSet: 1, multipleSameClientSets: 1, singleReferenceNotProof: 1,
  });
  assert.equal(report.reasonRowCounts.HISTORY_DELETION_MARKER_PRESENT, 3);
});

test("R04 single history links preserve both deletion-marker sides without deciding truth", () => {
  const factIds = ["synthetic-neither", "synthetic-history-only", "synthetic-set-only",
    "synthetic-both", "synthetic-unknown"];
  const histories: LegacyHistorySource[] = factIds.map((sourceFactId, index) => ({
    ...historyBase,
    sourceRowId: `synthetic-history-${index}`,
    sourceFactId,
    lifecycleShapeComplete: index !== 4,
    deletedAtRaw: index === 1 || index === 3 ? "2026-01-04" : null,
  }));
  const sets: LegacySetSource[] = factIds.map((sourceFactId, index) => ({
    ...base,
    sourceRowId: `synthetic-set-${index}`,
    sourceFactId,
    lifecycleShapeComplete: true,
    sessionDeletedAtRaw: index === 2 || index === 3 ? "2026-01-05" : null,
  }));
  const report = summarizeHistoryLinks(histories, sets);
  assert.deepEqual(report.singleReferenceDeletionCrossTab, {
    neitherMarked: 1,
    historyOnlyMarked: 1,
    setSideOnlyMarked: 1,
    bothMarked: 1,
    unknownLifecycleShape: 1,
  });
  assert.equal(report.reasonRowCounts.SINGLE_REFERENCE_NOT_PROOF, 5);
  assert.equal(report.blockedHistoryRows, 5);
});

test("R04 cross-tab never borrows a set from another client or account", () => {
  const report = summarizeHistoryLinks([
    { ...historyBase, lifecycleShapeComplete: true, deletedAtRaw: "2026-01-04" },
  ], [
    { ...base, clientId: "synthetic-client-b", lifecycleShapeComplete: true },
    { ...base, accountScope: "synthetic-other-account", lifecycleShapeComplete: true },
  ]);
  assert.equal(report.reasonRowCounts.NO_SAME_CLIENT_SET, 1);
  assert.equal(report.reasonRowCounts.SINGLE_REFERENCE_NOT_PROOF, 0);
  assert.equal(report.singleReferenceDeletionCrossTab.historyOnlyMarked, 0);
});

test("R04 missing history deletion column is reported separately", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const rows = readLegacyHistoryRows(db, "synthetic-account-scope");
    const sets = readLegacySetRows(db, "synthetic-account-scope");
    assert.ok(rows.every((row) => row.lifecycleShapeComplete === false));
    const report = summarizeHistoryLinks(rows, sets);
    assert.equal(report.reasonRowCounts.HISTORY_LIFECYCLE_COLUMN_MISSING, rows.length);
    assert.equal(report.reasonRowCounts.HISTORY_DELETION_MARKER_PRESENT, 0);
  } finally { db.close(); }
});

test("R04 history preflight isolates client and account scope", () => {
  const otherClient = { ...historyBase, clientId: "synthetic-client-b" };
  const otherAccount = { ...historyBase, accountScope: "synthetic-second-account", sourceRowId: "synthetic-history-2" };
  const candidates = preflightHistoryLinks([otherClient, otherAccount], [base]);
  assert.ok(candidates[0]?.reviewReasons.includes("NO_SAME_CLIENT_SET"));
  assert.ok(candidates[0]?.reviewReasons.includes("ONLY_OTHER_CLIENT_SET"));
  assert.ok(candidates[1]?.reviewReasons.includes("NO_SAME_CLIENT_SET"));
  assert.ok(!candidates[1]?.reviewReasons.includes("ONLY_OTHER_CLIENT_SET"));
});

test("R04 history preflight never synthesizes sets from unmatched or empty source IDs", () => {
  const rows: LegacyHistorySource[] = [
    { ...historyBase, sourceFactId: "synthetic-unmatched" },
    { ...historyBase, sourceRowId: "synthetic-history-2", sourceFactId: null },
  ];
  const report = summarizeHistoryLinks(rows, [base]);
  assert.equal(report.historyRows, 2);
  assert.equal(report.blockedHistoryRows, 2);
  assert.equal(report.reasonRowCounts.NO_SAME_CLIENT_SET, 2);
  assert.equal(report.reasonRowCounts.EMPTY_HISTORY_FACT_ID, 1);
  assert.ok(!JSON.stringify(report).includes("synthetic-unmatched"));
});

test("R04 history preflight rejects duplicate physical history identity", () => {
  assert.throws(() => preflightHistoryLinks([historyBase, { ...historyBase, sourceFactId: "different" }], [base]),
    { message: "R04_DUPLICATE_HISTORY_ROW_ID" });
});

test("R04 history reader retains all rows and rejects orphan client ownership", () => {
  const db = createSyntheticLegacyFixture();
  try {
    assert.equal(readLegacyHistoryRows(db, "synthetic-account-scope").length, 1);
  } finally { db.close(); }
  const orphanDb = createSyntheticLegacyFixture();
  try {
    orphanDb.exec("PRAGMA foreign_keys = OFF");
    orphanDb.prepare("INSERT INTO training_exercise_history VALUES (?, ?, ?)")
      .run("synthetic-orphan-history", "synthetic-missing-client", "synthetic-fact-2");
    assert.throws(() => readLegacyHistoryRows(orphanDb, "synthetic-account-scope"),
      { message: "R04_HISTORY_PROVENANCE_INCOMPLETE" });
  } finally { orphanDb.close(); }
});

test("R04 current-set links partition physical rows without cross-client matching", () => {
  const current: LegacyCurrentSetSource[] = [
    currentBase,
    { ...currentBase, sourceRowId: "synthetic-current-2", effectiveSourceFactId: "synthetic-many",
      setDeletedAtRaw: "2026-01-04" },
    { ...currentBase, sourceRowId: "synthetic-current-3", effectiveSourceFactId: "synthetic-other-owner" },
    { ...currentBase, sourceRowId: "synthetic-current-4", effectiveSourceFactId: null,
      originStatus: "invalid-json", completedAtRaw: null },
  ];
  const sessionSets: LegacySetSource[] = [base,
    { ...base, sourceRowId: "synthetic-many-a", sourceFactId: "synthetic-many" },
    { ...base, sourceRowId: "synthetic-many-b", sourceFactId: "synthetic-many" },
    { ...base, sourceRowId: "synthetic-other", clientId: "synthetic-client-b",
      sourceFactId: "synthetic-other-owner" }];
  const report = summarizeCurrentSetLinks(current, sessionSets);
  assert.equal(report.status, "requires-semantic-review");
  if (report.status !== "requires-semantic-review") return;
  assert.equal(report.physicalCurrentSetRows, 4);
  assert.equal(report.singleReferenceNotProof, 1);
  assert.equal(report.multipleSameClientSessionSets, 1);
  assert.equal(report.noSameClientSessionSet, 1);
  assert.equal(report.onlyOtherClientSessionSet, 1);
  assert.equal(report.unresolvedOriginRows, 1);
  assert.equal(report.completedMarkerRows, 3);
  assert.equal(report.setSideDeletionMarkerRows, 1);
  assert.equal(report.stateByLink.singleReferenceNotProof.completedOnly, 1);
  assert.equal(report.stateByLink.multipleSameClientSessionSets.completedAndDeleted, 1);
  assert.equal(report.stateByLink.noSameClientSessionSet.completedOnly, 1);
  assert.equal(report.stateByLink.unresolvedOriginRows.neitherMarked, 1);
  assert.equal(report.targetWrites, 0);
  assert.ok(!JSON.stringify(report).includes("synthetic-fact-1"));
});

test("R04 current-set state matrix keeps completion and deletion as distinct source signals", () => {
  const rows: LegacyCurrentSetSource[] = [
    { ...currentBase, sourceRowId: "synthetic-complete", effectiveSourceFactId: "synthetic-a" },
    { ...currentBase, sourceRowId: "synthetic-deleted", effectiveSourceFactId: "synthetic-b",
      completedAtRaw: null, exerciseDeletedAtRaw: "2026-01-04" },
    { ...currentBase, sourceRowId: "synthetic-both", effectiveSourceFactId: "synthetic-c",
      workoutDeletedAtRaw: "2026-01-04" },
    { ...currentBase, sourceRowId: "synthetic-neither", effectiveSourceFactId: "synthetic-d",
      completedAtRaw: null },
    { ...currentBase, sourceRowId: "synthetic-unknown", effectiveSourceFactId: "synthetic-e",
      lifecycleShapeComplete: false },
  ];
  const report = summarizeCurrentSetLinks(rows, []);
  assert.equal(report.status, "requires-semantic-review");
  if (report.status !== "requires-semantic-review") return;
  assert.deepEqual(report.stateByLink.noSameClientSessionSet, {
    completedOnly: 1, deletionOnly: 1, completedAndDeleted: 1,
    neitherMarked: 1, unknownLifecycleShape: 1,
  });
  assert.equal(report.noSameClientSessionSet, 5);
  assert.equal(report.lifecycleShapeMissingRows, 1);
});

test("R04 unpaired completion markers triangulate history within client and account scope only", () => {
  const factIds = ["synthetic-no-history", "synthetic-other-client", "synthetic-one-unmarked",
    "synthetic-one-marked", "synthetic-unknown-shape", "synthetic-multiple", "synthetic-session-linked"];
  const current: LegacyCurrentSetSource[] = factIds.map((effectiveSourceFactId, index) => ({
    ...currentBase, sourceRowId: `synthetic-current-${index}`, effectiveSourceFactId,
    sourceWorkoutId: index === 1 ? "synthetic-planned-workout-b" : "synthetic-planned-workout-a",
  }));
  current.push({ ...currentBase, sourceRowId: "synthetic-deleted-current",
    effectiveSourceFactId: "synthetic-no-history", setDeletedAtRaw: "2026-01-04" });
  const history: LegacyHistorySource[] = [
    { ...historyBase, sourceRowId: "synthetic-h-other-client", clientId: "synthetic-client-b",
      sourceFactId: "synthetic-other-client", lifecycleShapeComplete: true },
    { ...historyBase, sourceRowId: "synthetic-h-other-account",
      accountScope: "synthetic-other-account", sourceFactId: "synthetic-no-history",
      lifecycleShapeComplete: true },
    { ...historyBase, sourceRowId: "synthetic-h-unmarked", sourceFactId: "synthetic-one-unmarked",
      lifecycleShapeComplete: true, deletedAtRaw: null },
    { ...historyBase, sourceRowId: "synthetic-h-marked", sourceFactId: "synthetic-one-marked",
      lifecycleShapeComplete: true, deletedAtRaw: "2026-01-04" },
    { ...historyBase, sourceRowId: "synthetic-h-unknown", sourceFactId: "synthetic-unknown-shape",
      lifecycleShapeComplete: false },
    { ...historyBase, sourceRowId: "synthetic-h-multiple-1", sourceFactId: "synthetic-multiple",
      lifecycleShapeComplete: true },
    { ...historyBase, sourceRowId: "synthetic-h-multiple-2", sourceFactId: "synthetic-multiple",
      lifecycleShapeComplete: true },
  ];
  const snapshots: LegacyWorkoutSnapshotSource[] = [
    { accountScope: "synthetic-account-scope", sourceRowId: "synthetic-log-a",
      clientId: "synthetic-client-a", sourceWorkoutId: "synthetic-planned-workout-a",
      ownerLinkStatus: "matched", dataStatus: "exercise-array",
      lifecycleShapeComplete: true, deletedAtRaw: null },
    { accountScope: "synthetic-account-scope", sourceRowId: "synthetic-log-other",
      clientId: "synthetic-client-b", sourceWorkoutId: "synthetic-planned-workout-b",
      ownerLinkStatus: "matched", dataStatus: "exercise-array",
      lifecycleShapeComplete: true, deletedAtRaw: null },
  ];
  const report = triangulateUnpairedCompletedCurrentSets(current,
    [{ ...base, sourceFactId: "synthetic-session-linked" }], history, snapshots);
  assert.deepEqual(report, {
    candidateRows: 6,
    noSameClientHistory: 2,
    onlyOtherClientHistory: 1,
    singleHistoryWithoutDeletionMarker: 1,
    singleHistoryWithDeletionMarker: 1,
    singleHistoryUnknownLifecycleShape: 1,
    multipleSameClientHistory: 1,
    workoutSnapshotContext: {
      candidateRows: 2,
      noSameClientWorkoutLog: 1,
      onlyOtherClientWorkoutLog: 1,
      singleSameClientWorkoutLog: 1,
      multipleSameClientWorkoutLogs: 0,
      singleLogDeletionMarker: 0,
      singleLogInvalidJson: 0,
      singleLogMissingExerciseArray: 0,
      singleLogOwnerLinkMismatch: 0,
      singleLogLifecycleShapeUnknown: 0,
    },
    targetWrites: 0,
  });
  assert.ok(!JSON.stringify(report).includes("synthetic-client-a"));
});

test("R04 current-set reader keeps source origin, invalid JSON and physical cardinality separate", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec(`
      ALTER TABLE training_exercises ADD COLUMN deleted_at TEXT;
      ALTER TABLE training_workouts ADD COLUMN deleted_at TEXT;
      CREATE TABLE training_set_logs (
        id TEXT PRIMARY KEY, exercise_id TEXT, data_json TEXT,
        completed_at TEXT, deleted_at TEXT
      );
    `);
    const insert = db.prepare("INSERT INTO training_set_logs VALUES (?, ?, ?, ?, ?)");
    insert.run("synthetic-current-origin", "synthetic-planned-exercise-a",
      '{"historyOriginId":"synthetic-fact-a"}', "2026-01-03", null);
    insert.run("synthetic-fact-b", "synthetic-planned-exercise-b", "{}", null, "2026-01-04");
    insert.run("synthetic-current-invalid", "synthetic-planned-exercise-a", "{broken", null, null);
    insert.run("synthetic-current-unsupported", "synthetic-planned-exercise-a",
      '{"historyOriginId":42}', null, null);
    db.exec("BEGIN");
    const rows = readLegacyCurrentSetRowsInSnapshot(db, "synthetic-account-scope");
    db.exec("ROLLBACK");
    assert.equal(rows.length, 4);
    assert.equal(rows.find((row) => row.sourceRowId === "synthetic-current-origin")?.originStatus,
      "history-origin-id");
    assert.equal(rows.find((row) => row.sourceRowId === "synthetic-current-origin")?.effectiveSourceFactId,
      "synthetic-fact-a");
    assert.equal(rows.find((row) => row.sourceRowId === "synthetic-fact-b")?.originStatus, "row-id");
    assert.equal(rows.find((row) => row.sourceRowId === "synthetic-current-invalid")?.originStatus, "invalid-json");
    assert.equal(rows.find((row) => row.sourceRowId === "synthetic-current-unsupported")?.originStatus,
      "unsupported-origin");
    assert.ok(rows.every((row) => row.lifecycleShapeComplete));
    const report = summarizeCurrentSetLinks(rows, readLegacySetRows(db, "synthetic-account-scope"));
    assert.equal(report.status, "requires-semantic-review");
    if (report.status !== "requires-semantic-review") return;
    assert.equal(report.multipleSameClientSessionSets, 1);
    assert.equal(report.singleReferenceNotProof, 1);
    assert.equal(report.invalidJsonRows, 1);
    assert.equal(report.unsupportedOriginRows, 1);
    assert.equal(report.unresolvedOriginRows, 2);
  } finally { db.close(); }
});

test("R04 current-set reader blocks orphan exercise rather than dropping its row", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("CREATE TABLE training_set_logs (id TEXT PRIMARY KEY, exercise_id TEXT, data_json TEXT)");
    db.prepare("INSERT INTO training_set_logs VALUES (?, ?, ?)")
      .run("synthetic-orphan-current", "synthetic-missing-exercise", "{}");
    db.exec("BEGIN");
    assert.throws(() => readLegacyCurrentSetRowsInSnapshot(db, "synthetic-account-scope"),
      { message: "R04_CURRENT_SOURCE_PROVENANCE_INCOMPLETE" });
    db.exec("ROLLBACK");
  } finally { db.close(); }
});

test("R04 workout snapshot reader preserves physical rows and marks unresolved context", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec(`CREATE TABLE training_workout_logs (
      id TEXT PRIMARY KEY, client_id TEXT, workout_id TEXT, data_json TEXT, deleted_at TEXT
    )`);
    const insert = db.prepare("INSERT INTO training_workout_logs VALUES (?, ?, ?, ?, ?)");
    insert.run("synthetic-log-valid", "synthetic-client-a", "synthetic-planned-workout-a",
      '{"exercises":[]}', null);
    insert.run("synthetic-log-invalid", "synthetic-client-a", "synthetic-planned-workout-a",
      "{broken", "2026-01-04");
    insert.run("synthetic-log-missing-workout", "synthetic-client-a", "synthetic-no-workout",
      '{}', null);
    db.exec("BEGIN");
    const rows = readLegacyWorkoutSnapshotRowsInSnapshot(db, "synthetic-account-scope");
    db.exec("ROLLBACK");
    assert.equal(rows.length, 3);
    assert.equal(rows.find((row) => row.sourceRowId === "synthetic-log-valid")?.dataStatus,
      "exercise-array");
    assert.equal(rows.find((row) => row.sourceRowId === "synthetic-log-invalid")?.dataStatus,
      "invalid-json");
    assert.equal(rows.find((row) => row.sourceRowId === "synthetic-log-missing-workout")?.ownerLinkStatus,
      "missing-workout");
    assert.ok(rows.every((row) => row.lifecycleShapeComplete));
  } finally { db.close(); }
});

test("R04 workout snapshot reader never substitutes a different client as owner", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("CREATE TABLE training_workout_logs (id TEXT PRIMARY KEY, client_id TEXT, workout_id TEXT, data_json TEXT)");
    const insert = db.prepare("INSERT INTO training_workout_logs VALUES (?, ?, ?, ?)");
    insert.run("synthetic-cross-owner", "synthetic-client-a", "synthetic-planned-workout-b",
      '{"exercises":[]}');
    db.exec("BEGIN");
    const [row] = readLegacyWorkoutSnapshotRowsInSnapshot(db, "synthetic-account-scope");
    db.exec("ROLLBACK");
    assert.equal(row?.ownerLinkStatus, "different-client");
    db.exec("PRAGMA foreign_keys=OFF");
    insert.run("synthetic-orphan-owner", "synthetic-missing-client", "synthetic-planned-workout-a", "{}");
    db.exec("BEGIN");
    assert.throws(() => readLegacyWorkoutSnapshotRowsInSnapshot(db, "synthetic-account-scope"),
      { message: "R04_WORKOUT_SNAPSHOT_PROVENANCE_INCOMPLETE" });
    db.exec("ROLLBACK");
  } finally { db.close(); }
});

test("R04 archive reader keeps snapshots separate and exposes structural ambiguity", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("ALTER TABLE training_archive_entries ADD COLUMN deleted_at TEXT");
    const insert = db.prepare(`INSERT INTO training_archive_entries
      (id, client_id, archived_at, data_json, deleted_at) VALUES (?, ?, ?, ?, ?)`);
    insert.run("synthetic-archive-same", "synthetic-client-a", "2026-01-03",
      '{"programId":"synthetic-program-a","workouts":[{},{}],"weeks":[],"totalWorkouts":2}', null);
    insert.run("synthetic-archive-other", "synthetic-client-a", "2026-01-04",
      '{"programId":"synthetic-program-b","workouts":[],"totalWorkouts":1}', "2026-01-05");
    insert.run("synthetic-archive-not-found", "synthetic-client-a", "2026-01-04",
      '{"programId":"synthetic-missing-program","workouts":[]}', null);
    insert.run("synthetic-archive-invalid", "synthetic-client-a", "2026-01-04", "{broken", null);
    db.exec("BEGIN");
    const rows = readLegacyArchiveRowsInSnapshot(db, "synthetic-account-scope");
    db.exec("ROLLBACK");
    assert.equal(rows.length, 5);
    const report = summarizeArchiveSource(rows);
    assert.equal(report.physicalArchiveRows, 5);
    assert.equal(report.programSameClientRows, 1);
    assert.equal(report.programOtherClientRows, 1);
    assert.equal(report.otherClientSharedBookCandidateRows, 1);
    assert.equal(report.otherClientNoSameBookRows, 0);
    assert.equal(report.programNotFoundRows, 1);
    assert.equal(report.programIdMissingRows, 2);
    assert.equal(report.invalidJsonRows, 1);
    assert.equal(report.workoutArrayRows, 3);
    assert.equal(report.totalNestedWorkoutRows, 2);
    assert.equal(report.declaredWorkoutCountMismatchRows, 1);
    assert.equal(report.deletionMarkerRows, 1);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("synthetic-program-a"));
    assert.throws(() => summarizeArchiveSource([rows[0]!, rows[0]!]),
      { message: "R04_DUPLICATE_ARCHIVE_ROW_ID" });
  } finally { db.close(); }
});

test("R04 archive cross-client book signal is not invented for a different book", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.prepare("INSERT INTO training_archive_entries VALUES (?, ?, ?, ?)")
      .run("synthetic-cross-book-archive", "synthetic-client-b", "2026-01-04",
        '{"programId":"synthetic-archived-program","workouts":[]}');
    db.exec("BEGIN");
    const rows = readLegacyArchiveRowsInSnapshot(db, "synthetic-account-scope");
    db.exec("ROLLBACK");
    const row = rows.find((item) => item.sourceRowId === "synthetic-cross-book-archive");
    assert.equal(row?.programReferenceStatus, "other-client");
    assert.equal(row?.otherClientSharedBookCandidate, false);
    const report = summarizeArchiveSource(rows);
    assert.equal(report.otherClientNoSameBookRows, 1);
    assert.equal(report.otherClientSharedBookCandidateRows, 0);
  } finally { db.close(); }
});

test("R04 archive reader blocks an orphan client without exposing source rows", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("PRAGMA foreign_keys=OFF");
    db.prepare("INSERT INTO training_archive_entries VALUES (?, ?, ?, ?)")
      .run("synthetic-orphan-archive", "synthetic-missing-client", "2026-01-04", "{}");
    db.exec("BEGIN");
    assert.throws(() => readLegacyArchiveRowsInSnapshot(db, "synthetic-account-scope"),
      { message: "R04_ARCHIVE_PROVENANCE_INCOMPLETE" });
    db.exec("ROLLBACK");
  } finally { db.close(); }
});

test("R04 current-set summary rejects duplicate physical IDs", () => {
  assert.throws(() => summarizeCurrentSetLinks([currentBase, currentBase], [base]),
    { message: "R04_DUPLICATE_CURRENT_SOURCE_ROW_ID" });
});

test("R04 set and history readers share one snapshot and release it after success or failure", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const evidence = readLegacyEvidence(db, "synthetic-account-scope");
    assert.equal(evidence.sets.length, 6);
    assert.equal(evidence.history.length, 1);
    db.exec("BEGIN");
    db.exec("ROLLBACK");
  } finally { db.close(); }
  const brokenDb = createSyntheticLegacyFixture();
  try {
    brokenDb.exec("DROP TABLE training_exercise_history");
    assert.throws(() => readLegacyEvidence(brokenDb, "synthetic-account-scope"),
      { message: "R04_HISTORY_SHAPE_UNSUPPORTED" });
    brokenDb.exec("BEGIN");
    brokenDb.exec("ROLLBACK");
  } finally { brokenDb.close(); }
});

test("R04 observed table registry lists 43 names without claiming target mapping", () => {
  const names = [...observedBuild120Tables.sourceGateInspected, ...observedBuild120Tables.mappingPending];
  assert.equal(names.length, 43);
  assert.equal(new Set(names).size, 43);
  assert.equal(observedBuild120Tables.sourceGateInspected.length, 17);
  assert.equal(observedBuild120Tables.mappingPending.length, 26);
});

test("R04 exact source-table shape still requires mapping and ignores SQLite internals", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic_gate (id INTEGER PRIMARY KEY AUTOINCREMENT)");
    db.exec("CREATE TABLE synthetic_pending (id TEXT PRIMARY KEY)");
    const report = auditLegacyTableCoverage(db, {
      sourceGateInspected: ["synthetic_gate"], mappingPending: ["synthetic_pending"],
    });
    assert.equal(report.status, "requires-mapping");
    assert.equal(report.observedTableCount, 2);
    assert.equal(report.countedTables, 2);
    assert.equal(report.totalPhysicalRows, 0);
    assert.equal(report.explicitKeyTables, 2);
    assert.equal(report.rowsWithoutCompleteKey, 0);
    assert.equal(report.mappingPendingTables, 1);
    assert.equal(report.targetMappedTables, 0);
  } finally { db.close(); }
});

test("R04 source identity refuses rowid fallback for tables without a primary key", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic_no_key (value TEXT)");
    db.exec("INSERT INTO synthetic_no_key VALUES ('synthetic-value')");
    const report = auditLegacyTableCoverage(db, {
      sourceGateInspected: ["synthetic_no_key"], mappingPending: [],
    });
    assert.equal(report.status, "blocked-source-identity");
    assert.equal(report.unkeyedTables, 1);
    assert.equal(report.rowsWithoutCompleteKey, 1);
    assert.equal(report.keyCandidateRows, 0);
    assert.ok(!JSON.stringify(report).includes("synthetic-value"));
  } finally { db.close(); }
});

test("R04 source identity blocks nullable composite keys without inventing IDs", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic_partial (left_id TEXT, right_id TEXT, PRIMARY KEY(left_id,right_id))");
    db.exec("INSERT INTO synthetic_partial VALUES (NULL,'synthetic-right')");
    const report = auditLegacyTableCoverage(db, {
      sourceGateInspected: ["synthetic_partial"], mappingPending: [],
    });
    assert.equal(report.status, "blocked-source-identity");
    assert.equal(report.explicitKeyTables, 1);
    assert.equal(report.compositeKeyTables, 1);
    assert.equal(report.rowsWithoutCompleteKey, 1);
    assert.equal(report.keyCandidateRows, 0);
    assert.throws(() => summarizeLegacySourceIdentity(db, ["synthetic_partial", "synthetic_partial"], 2),
      { message: "R04_SOURCE_IDENTITY_DUPLICATE_TABLE" });
  } finally { db.close(); }
});

test("R04 source key ledger changes when a primary key changes but counts do not", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic_keys (id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE synthetic_other (id INTEGER PRIMARY KEY)");
    db.exec("INSERT INTO synthetic_keys VALUES ('synthetic-a')");
    db.exec("INSERT INTO synthetic_other VALUES (1)");
    const names = ["synthetic_keys", "synthetic_other"];
    const before = summarizeLegacySourceIdentity(db, names, 2);
    assert.equal(before.enumeratedKeyRows, 2);
    assert.equal(before.keyCandidateRows, 2);
    assert.equal(before.sourceKeyLedgerDigest,
      summarizeLegacySourceIdentity(db, [...names].reverse(), 2).sourceKeyLedgerDigest);
    assert.ok(!JSON.stringify(before).includes("synthetic-a"));
    const scopedA = summarizeLegacySourceIdentity(db, names, 2, "synthetic-account-a");
    const scopedB = summarizeLegacySourceIdentity(db, names, 2, "synthetic-account-b");
    assert.equal(scopedA.sourceScopeBound, true);
    assert.notEqual(scopedA.sourceKeyLedgerDigest, scopedB.sourceKeyLedgerDigest);
    assert.ok(!JSON.stringify(scopedA).includes("synthetic-account-a"));
    db.exec("DELETE FROM synthetic_keys WHERE id='synthetic-a'");
    db.exec("INSERT INTO synthetic_keys VALUES ('synthetic-b')");
    const after = summarizeLegacySourceIdentity(db, names, 2);
    assert.equal(after.keyCandidateRows, before.keyCandidateRows);
    assert.notEqual(after.sourceKeyLedgerDigest, before.sourceKeyLedgerDigest);
  } finally { db.close(); }
});

test("R04 source key ledger preserves adjacent SQLite integers beyond JS safe range", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic_large_key (id INTEGER PRIMARY KEY)");
    const insert = db.prepare("INSERT INTO synthetic_large_key(id) VALUES (?)");
    insert.run(9007199254740992n);
    const before = summarizeLegacySourceIdentity(db, ["synthetic_large_key"], 1);
    db.exec("DELETE FROM synthetic_large_key");
    insert.run(9007199254740993n);
    const after = summarizeLegacySourceIdentity(db, ["synthetic_large_key"], 1);
    assert.equal(after.enumeratedKeyRows, 1);
    assert.notEqual(after.sourceKeyLedgerDigest, before.sourceKeyLedgerDigest);
  } finally { db.close(); }
});

test("R04 row inventory counts every physical table without leaking names or records", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec('CREATE TABLE "synthetic""quoted" (id TEXT PRIMARY KEY)');
    db.exec("CREATE TABLE synthetic_empty (id TEXT PRIMARY KEY)");
    db.exec('INSERT INTO "synthetic""quoted" VALUES (\'synthetic-a\'), (\'synthetic-b\')');
    const names = ['synthetic"quoted', "synthetic_empty"];
    const first = summarizeLegacyRowInventory(db, names);
    assert.equal(first.countedTables, 2);
    assert.equal(first.nonemptyTables, 1);
    assert.equal(first.totalPhysicalRows, 2);
    assert.equal(first.rowCountLedgerDigest,
      summarizeLegacyRowInventory(db, [...names].reverse()).rowCountLedgerDigest);
    assert.ok(!JSON.stringify(first).includes("synthetic-a"));
    assert.ok(!JSON.stringify(first).includes("synthetic\"quoted"));
    db.exec("INSERT INTO synthetic_empty VALUES ('synthetic-c')");
    const second = summarizeLegacyRowInventory(db, names);
    assert.equal(second.totalPhysicalRows, 3);
    assert.equal(second.nonemptyTables, 2);
    assert.notEqual(second.rowCountLedgerDigest, first.rowCountLedgerDigest);
    assert.throws(() => summarizeLegacyRowInventory(db, [names[0]!, names[0]!]),
      { message: "R04_ROW_INVENTORY_DUPLICATE_TABLE" });
  } finally { db.close(); }
});

test("R04 table coverage blocks both unregistered and missing tables without naming them", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic_known (id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE synthetic_extra (id TEXT PRIMARY KEY)");
    const report = auditLegacyTableCoverage(db, {
      sourceGateInspected: ["synthetic_known"], mappingPending: ["synthetic_missing"],
    });
    assert.equal(report.status, "blocked-source-shape");
    assert.equal(report.unregisteredTables, 1);
    assert.equal(report.missingRegisteredTables, 1);
    assert.ok(!JSON.stringify(report).includes("synthetic_extra"));
    assert.ok(!JSON.stringify(report).includes("synthetic_missing"));
  } finally { db.close(); }
});

test("R04 table coverage rejects duplicate registry names", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(() => auditLegacyTableCoverage(db, {
      sourceGateInspected: ["synthetic_duplicate"], mappingPending: ["synthetic_duplicate"],
    }), { message: "R04_COVERAGE_REGISTRY_INVALID" });
  } finally { db.close(); }
});

test("R04 table coverage blocks column drift even when all table names still match", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic_shape (id TEXT PRIMARY KEY, value INTEGER DEFAULT 1)");
    const names = ["synthetic_shape"];
    const columnShapeDigest = computeLegacyColumnShapeDigest(db, names);
    const registry = { sourceGateInspected: names, mappingPending: [], columnShapeDigest };
    const before = auditLegacyTableCoverage(db, registry);
    assert.equal(before.status, "requires-mapping");
    assert.equal(before.columnShapeMatchesObservedBaseline, true);

    db.exec("PRAGMA query_only = OFF");
    db.exec("ALTER TABLE synthetic_shape ADD COLUMN extra TEXT");
    const after = auditLegacyTableCoverage(db, registry);
    assert.equal(after.observedTableCount, 1);
    assert.equal(after.missingRegisteredTables, 0);
    assert.equal(after.unregisteredTables, 0);
    assert.equal(after.columnShapeMatchesObservedBaseline, false);
    assert.equal(after.status, "blocked-source-shape");
    assert.ok(!JSON.stringify(after).includes("synthetic_shape"));
  } finally { db.close(); }
});

test("R04 table coverage blocks index drift when table and column shapes still match", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic_index (id TEXT PRIMARY KEY, lookup TEXT)");
    const names = ["synthetic_index"];
    const registry = {
      sourceGateInspected: names, mappingPending: [],
      columnShapeDigest: computeLegacyColumnShapeDigest(db, names),
      schemaDigest: computeLegacySchemaDigest(db),
    };
    assert.equal(auditLegacyTableCoverage(db, registry).status, "requires-mapping");
    db.exec("PRAGMA query_only = OFF");
    db.exec("CREATE INDEX synthetic_lookup_idx ON synthetic_index(lookup)");
    const report = auditLegacyTableCoverage(db, registry);
    assert.equal(report.columnShapeMatchesObservedBaseline, true);
    assert.equal(report.schemaMatchesObservedBaseline, false);
    assert.equal(report.status, "blocked-source-shape");
  } finally { db.close(); }
});

test("R04 file table coverage flags incomplete synthetic source without altering bytes", () => {
  withSyntheticCopy(() => {}, (path) => {
    const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
    const before = hash();
    const report = auditLegacyTableCoverageFile(path);
    assert.equal(report.status, "blocked-source-shape");
    if (report.status === "blocked-source-shape") {
      assert.ok(report.missingRegisteredTables > 0);
      assert.equal(report.sourceScopeBound, true);
    }
    assert.equal(hash(), before);
  });
});

test("R04 full audit combines coverage and fact evidence in one read-only file pass", () => {
  withSyntheticCopy(() => {}, (path) => {
    const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
    const before = hash();
    const registry = {
      sourceGateInspected: ["athlete_backup_manifest", "account_database_binding", "schema_migrations",
        ...Object.keys(fixtureRows)], mappingPending: [],
    };
    const report = auditR04FullCopy(path, registry);
    assert.equal(report.status, "requires-semantic-review");
    if (report.status === "requires-semantic-review") {
      assert.equal(report.coverage.observedTableCount, registry.sourceGateInspected.length);
      assert.equal(report.coverage.countedTables, registry.sourceGateInspected.length);
      assert.equal(report.coverage.sourceScopeBound, true);
      assert.equal(report.sourceFacts.sourceRows, 6);
      assert.equal(report.sourceFacts.targetWrites, 0);
      assert.equal(report.setMetrics.sourceRows, 6);
      assert.equal(report.setMetrics.trackingProfile, "LOAD_REPS");
      assert.equal(report.setMetrics.exactValueRows, 6);
      assert.equal(report.setMetrics.requiresValueReviewRows, 0);
      assert.equal(report.setMetrics.targetWrites, 0);
      assert.equal(report.history.historyRows, 1);
      assert.deepEqual(report.currentSets, { status: "not-observed-in-source", targetWrites: 0 });
      assert.equal(report.currentHistoryTriangulation, null);
      assert.equal(report.archives?.physicalArchiveRows, 1);
      assert.equal(report.archives?.targetWrites, 0);
    }
    assert.equal(hash(), before);
    assert.ok(!JSON.stringify(report).includes("synthetic-client-a"));
  });
});

test("R04 full audit blocks an unregistered table before classifying facts", () => {
  withSyntheticCopy(() => {}, (path) => {
    const report = auditR04FullCopy(path, {
      sourceGateInspected: ["athlete_backup_manifest"], mappingPending: [],
    });
    assert.deepEqual(report, { status: "blocked", reasons: ["R04_SOURCE_COVERAGE_SHAPE_BLOCKED"] });
  });
});

test("R04 nutrition counts actual food entries, never water or legacy recorded flag alone", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_days (client_id TEXT, date_key TEXT, meals_json TEXT,
        meals_recorded INTEGER, water_ml INTEGER);
      INSERT INTO clients VALUES ('synthetic-client');`);
    const insert = db.prepare("INSERT INTO nutrition_days VALUES ('synthetic-client', ?, ?, ?, ?)");
    const meals = (entries: unknown[]) => JSON.stringify({
      breakfast: entries, lunch: [], dinner: [], snack: [],
    });
    insert.run("2026-01-01", meals([]), 1, 300);
    insert.run("2026-01-02", meals([{ id: "entry-1", productId: "product-1",
      calories: 100, protein: null, fat: 1, carbs: 2 }]), 0, 0);
    insert.run("2026-01-03", meals([]), 0, 400);
    insert.run("2026-01-04", meals([{ id: "entry-2", productId: "product-2" }]), 1, 0);
    const report = summarizeNutritionSource(readLegacyNutritionDayRowsInSnapshot(db, "scope"));
    assert.equal(report.physicalDayRows, 4);
    assert.equal(report.foodCandidateDays, 2);
    assert.equal(report.foodCandidateEntries, 2);
    assert.equal(report.emptyMealDays, 2);
    assert.equal(report.waterOnlyDays, 2);
    assert.equal(report.flagWithoutFoodDays, 1);
    assert.equal(report.foodWithoutFlagDays, 1);
    assert.equal(report.unknownMacroEntryRows, 2);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("synthetic-client"));
  } finally { db.close(); }
});

test("R04 nutrition quarantines malformed payloads and incomplete entries", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_days (client_id TEXT, date_key TEXT, meals_json TEXT,
        meals_recorded INTEGER, water_ml INTEGER);
      INSERT INTO clients VALUES ('synthetic-client');`);
    const insert = db.prepare("INSERT INTO nutrition_days VALUES ('synthetic-client', ?, ?, 0, 0)");
    insert.run("2026-01-01", "{");
    insert.run("2026-01-02", JSON.stringify({ breakfast: [{}], lunch: [], dinner: [], snack: [] }));
    insert.run("2026-01-03", JSON.stringify({ breakfast: [], lunch: [] }));
    const report = summarizeNutritionSource(readLegacyNutritionDayRowsInSnapshot(db, "scope"));
    assert.equal(report.malformedMealDays, 2);
    assert.equal(report.ambiguousEntryDays, 1);
    assert.equal(report.foodCandidateDays, 0);
    assert.equal(report.emptyMealDays, 0);
  } finally { db.close(); }
});

test("R04 nutrition never counts food attributed to an absent client", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_days (client_id TEXT, date_key TEXT, meals_json TEXT,
        meals_recorded INTEGER, water_ml INTEGER);`);
    db.prepare("INSERT INTO nutrition_days VALUES (?, ?, ?, 1, 0)").run(
      "synthetic-orphan", "2026-01-01", JSON.stringify({
        breakfast: [{ id: "entry", productId: "product" }],
        lunch: [], dinner: [], snack: [],
      }));
    const report = summarizeNutritionSource(readLegacyNutritionDayRowsInSnapshot(db, "scope"));
    assert.equal(report.physicalDayRows, 1);
    assert.equal(report.missingOwnerDays, 1);
    assert.equal(report.foodCandidateDays, 0);
    assert.equal(report.targetWrites, 0);
  } finally { db.close(); }
});

test("R04 measurements preserve wide rows, missing values, comma decimals and duplicate day context", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE client_measurements (id TEXT PRIMARY KEY, client_id TEXT,
        date_key TEXT, neck TEXT, shoulders TEXT, chest TEXT, waist TEXT,
        hips TEXT, upper_arm TEXT, thigh TEXT, calf TEXT);
      INSERT INTO clients VALUES ('synthetic-client');`);
    const insert = db.prepare("INSERT INTO client_measurements VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("row-1", "synthetic-client", "2026-01-01", "35,5", null, "0", "bad", "90", null, null, null);
    insert.run("row-2", "synthetic-client", "2026-01-01", null, null, null, "80", null, null, null, null);
    insert.run("row-3", "synthetic-client", "2026-02-30", null, null, null, null, null, null, null, null);
    const rows = readLegacyMeasurementRowsInSnapshot(db, "scope");
    const report = summarizeMeasurementSource(rows);
    assert.equal(report.physicalRows, 3);
    assert.equal(report.sameClientDateGroupsWithMultipleRows, 1);
    assert.equal(report.numericValues, 3);
    assert.equal(report.commaDecimalValues, 1);
    assert.equal(report.nonpositiveValues, 1);
    assert.equal(report.invalidValues, 1);
    assert.equal(report.invalidDateRows, 1);
    assert.equal(report.emptyRows, 1);
    assert.equal(report.unitUnverifiedValues, 3);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("synthetic-client"));
    const atoms = buildMeasurementValueCandidates(rows);
    const atomReport = summarizeMeasurementValueCandidates(atoms);
    assert.equal(atoms.length, 5);
    assert.equal(atomReport.exactDecimalCandidates, 3);
    assert.equal(atomReport.invalidValueCandidates, 2);
    assert.equal(atomReport.targetMappedValues, 0);
    assert.equal(atomReport.targetWrites, 0);
    assert.ok(!JSON.stringify(atomReport).includes("synthetic-client"));
    const neck = atoms.find((atom) => atom.sourceRowId === "row-1" && atom.sourceField === "neck");
    assert.equal(neck?.normalizedDecimal, "35.5");
    assert.deepEqual(neck?.issues, ["UNIT_UNVERIFIED"]);
    assert.equal(neck?.datePrecision, "DATE");
    assert.equal(neck?.measuredAt, null);
  } finally { db.close(); }
});

test("R04 measurement orphan stays visible and duplicate physical identity blocks summary", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE client_measurements (id TEXT PRIMARY KEY, client_id TEXT,
        date_key TEXT, neck TEXT, shoulders TEXT, chest TEXT, waist TEXT,
        hips TEXT, upper_arm TEXT, thigh TEXT, calf TEXT);
      INSERT INTO client_measurements VALUES ('row-1','missing-client','2026-01-01',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);`);
    const rows = readLegacyMeasurementRowsInSnapshot(db, "scope");
    assert.equal(summarizeMeasurementSource(rows).missingOwnerRows, 1);
    assert.throws(() => summarizeMeasurementSource([...rows, ...rows]),
      { message: "R04_DUPLICATE_MEASUREMENT_ROW_ID" });
    assert.throws(() => buildMeasurementValueCandidates([...rows, ...rows]),
      { message: "R04_DUPLICATE_MEASUREMENT_ROW_ID" });
  } finally { db.close(); }
});

test("R04 measurement atoms preserve extra precision and quarantine owner/date independently", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE client_measurements (id TEXT PRIMARY KEY, client_id TEXT,
        date_key TEXT, neck TEXT, shoulders TEXT, chest TEXT, waist TEXT,
        hips TEXT, upper_arm TEXT, thigh TEXT, calf TEXT);
      INSERT INTO client_measurements VALUES
        ('row-1','absent-client','2026-02-30','35,555',NULL,NULL,NULL,NULL,NULL,NULL,NULL);`);
    const atoms = buildMeasurementValueCandidates(readLegacyMeasurementRowsInSnapshot(db, "scope"));
    assert.equal(atoms.length, 1);
    assert.equal(atoms[0]?.normalizedDecimal, "35.555");
    assert.deepEqual(atoms[0]?.issues, ["MISSING_OWNER", "INVALID_DATE", "UNIT_UNVERIFIED"]);
    const report = summarizeMeasurementValueCandidates(atoms);
    assert.equal(report.missingOwnerCandidates, 1);
    assert.equal(report.invalidDateCandidates, 1);
    assert.equal(report.targetMappedValues, 0);
    assert.equal(report.targetWrites, 0);
  } finally { db.close(); }
});

test("R04 calendar keeps guest, client and unassigned rows separate from workout and ledger", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE calendar_appointments (id TEXT PRIMARY KEY, date_key TEXT,
        start_time TEXT, end_time TEXT, duration_minutes INTEGER,
        client_id TEXT, guest_name TEXT, appointment_type TEXT, deleted_at TEXT);
      INSERT INTO clients VALUES ('synthetic-client');`);
    const insert = db.prepare("INSERT INTO calendar_appointments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("client", "2026-01-01", "09:00", "10:00", 60,
      "synthetic-client", null, "training", null);
    insert.run("guest", "2026-01-02", "10:00", "11:00", 60,
      null, "Synthetic Guest", "guest_visit", "2026-01-03");
    insert.run("unassigned", "2026-01-03", "10:00", "11:00", 60,
      null, null, "training", null);
    const report = summarizeCalendarSource(readLegacyCalendarRowsInSnapshot(db, "scope"));
    assert.equal(report.physicalRows, 3);
    assert.equal(report.clientLinkedRows, 1);
    assert.equal(report.guestRows, 1);
    assert.equal(report.unassignedRows, 1);
    assert.equal(report.deletionMarkerRows, 1);
    assert.equal(report.workoutFactsCreated, 0);
    assert.equal(report.creditSettlementsCreated, 0);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("Synthetic Guest"));
  } finally { db.close(); }
});

test("R04 calendar marks bad date, time, owner and type without dropping physical rows", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE calendar_appointments (id TEXT PRIMARY KEY, date_key TEXT,
        start_time TEXT, end_time TEXT, duration_minutes INTEGER,
        client_id TEXT, guest_name TEXT, appointment_type TEXT, deleted_at TEXT);`);
    const insert = db.prepare("INSERT INTO calendar_appointments VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)");
    insert.run("orphan", "2026-02-30", "25:00", "11:00", 60,
      "missing-client", null, "unknown-kind");
    insert.run("mismatch", "2026-01-03", "10:00", "12:00", 60,
      null, "Guest", "guest_visit");
    const rows = readLegacyCalendarRowsInSnapshot(db, "scope");
    const report = summarizeCalendarSource(rows);
    assert.equal(report.missingClientRows, 1);
    assert.equal(report.invalidDateRows, 1);
    assert.equal(report.invalidTimeShapeRows, 1);
    assert.equal(report.endMismatchRows, 1);
    assert.equal(report.unknownTypeRows, 1);
    assert.throws(() => summarizeCalendarSource([...rows, ...rows]),
      { message: "R04_DUPLICATE_CALENDAR_ROW_ID" });
  } finally { db.close(); }
});

test("R04 client day facts keep missing weight separate from zero and text training from workouts", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE client_day_facts (client_id TEXT, date_key TEXT, weight TEXT,
        steps TEXT, training TEXT, PRIMARY KEY(client_id,date_key));
      INSERT INTO clients VALUES ('synthetic-client');`);
    const insert = db.prepare("INSERT INTO client_day_facts VALUES ('synthetic-client', ?, ?, ?, ?)");
    insert.run("2026-01-01", "", "", "Да");
    insert.run("2026-01-02", "82,5", "0", "Нет");
    insert.run("2026-01-03", "0", "12", "");
    const report = summarizeClientDaySource(readLegacyClientDayRowsInSnapshot(db, "scope"));
    assert.equal(report.physicalRows, 3);
    assert.equal(report.weightPresentRows, 2);
    assert.equal(report.weightCommaRows, 1);
    assert.equal(report.stepsPresentRows, 2);
    assert.equal(report.trainingYesRows, 1);
    assert.equal(report.trainingNoRows, 1);
    assert.equal(report.trainingMissingRows, 1);
    assert.equal(report.workoutFactsCreated, 0);
    assert.equal(report.measurementsCreated, 0);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("synthetic-client"));
  } finally { db.close(); }
});

test("R04 client day facts expose malformed values, orphan owner and duplicate day key", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE client_day_facts (client_id TEXT, date_key TEXT, weight TEXT,
        steps TEXT, training TEXT, PRIMARY KEY(client_id,date_key));
      INSERT INTO client_day_facts VALUES ('synthetic-orphan','2026-02-30','bad','1,5','maybe');`);
    const rows = readLegacyClientDayRowsInSnapshot(db, "scope");
    const report = summarizeClientDaySource(rows);
    assert.equal(report.missingOwnerRows, 1);
    assert.equal(report.invalidDateRows, 1);
    assert.equal(report.weightInvalidRows, 1);
    assert.equal(report.stepsInvalidRows, 1);
    assert.equal(report.trainingUnknownRows, 1);
    assert.throws(() => summarizeClientDaySource([...rows, ...rows]),
      { message: "R04_DUPLICATE_CLIENT_DAY_KEY" });
  } finally { db.close(); }
});

test("R04 daily weight stays date-only and profile weight is a comparison signal, never a fact", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, weight TEXT);
      CREATE TABLE client_day_facts (client_id TEXT, date_key TEXT, weight TEXT,
        steps TEXT, training TEXT, PRIMARY KEY(client_id,date_key));
      INSERT INTO clients VALUES ('synthetic-a','080,0'),('synthetic-b','70'),('synthetic-c','bad');
      INSERT INTO client_day_facts VALUES
        ('synthetic-a','2026-01-01','80.00',NULL,NULL),
        ('synthetic-a','2026-01-02','81',NULL,NULL),
        ('synthetic-b','2026-01-01','71',NULL,NULL),
        ('synthetic-c','2026-01-01','0',NULL,NULL),
        ('synthetic-orphan','2026-02-30','50',NULL,NULL);`);
    const days = buildDailyWeightCandidates(readLegacyClientDayRowsInSnapshot(db, "scope"));
    const profiles = readLegacyProfileWeightsInSnapshot(db, "scope");
    const report = reconcileLegacyWeightSources(profiles, days);
    assert.equal(report.profileRows, 3);
    assert.equal(report.profilePositiveSnapshots, 2);
    assert.equal(report.profileInvalidOrNonpositive, 1);
    assert.equal(report.dailyWeightRows, 5);
    assert.equal(report.dailyExactPositiveValues, 3);
    assert.equal(report.dailyBlockedValues, 2);
    assert.equal(report.clientsWithBothSources, 2);
    assert.equal(report.sameValueSignalClients, 1);
    assert.equal(report.noSameValueSignalClients, 1);
    assert.equal(report.targetMappedMeasurements, 0);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("synthetic-a"));
    const first = days.find((day) => day.clientId === "synthetic-a"
      && day.localDate === "2026-01-01");
    assert.equal(first?.normalizedDecimal, "80.00");
    assert.deepEqual(first?.issues, ["UNIT_UNVERIFIED"]);
    assert.equal(first?.measuredAt, null);
    assert.deepEqual(days.find((day) => day.clientId === "synthetic-c")?.issues,
      ["NONPOSITIVE_VALUE"]);
    assert.deepEqual(days.find((day) => day.clientId === "synthetic-orphan")?.issues,
      ["MISSING_OWNER", "INVALID_DATE", "UNIT_UNVERIFIED"]);
    assert.throws(() => buildDailyWeightCandidates([
      ...readLegacyClientDayRowsInSnapshot(db, "scope"),
      ...readLegacyClientDayRowsInSnapshot(db, "scope"),
    ]), { message: "R04_DUPLICATE_CLIENT_DAY_KEY" });
    assert.throws(() => reconcileLegacyWeightSources([...profiles, ...profiles], days),
      { message: "R04_DUPLICATE_PROFILE_WEIGHT_CLIENT" });
  } finally { db.close(); }
});

test("R04 client identity keeps source workspace and archive/deletion distinct without target IDs", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, workspace_id TEXT,
      name TEXT, created_at TEXT, updated_at TEXT, archived_at TEXT, deleted_at TEXT);
      INSERT INTO clients VALUES
        ('active','workspace-a','Synthetic Active','2026-01-01T09:00:00Z',
         '2026-01-02T09:00:00Z',NULL,NULL),
        ('archived','workspace-a','Synthetic Archived','2026-01-01T09:00:00Z',
         '2026-01-02T09:00:00Z','2026-01-03T09:00:00Z',NULL),
        ('deleted','workspace-b','Synthetic Deleted','2026-01-01T09:00:00Z',
         '2026-01-02T09:00:00Z',NULL,'2026-01-03T09:00:00Z'),
        ('incomplete',NULL,'  ','bad','bad','bad',NULL);`);
    const rows = readLegacyClientIdentityInSnapshot(db, "scope");
    const report = summarizeLegacyClientIdentity(rows);
    assert.equal(report.physicalClientRows, 4);
    assert.equal(report.sourceWorkspaceCount, 2);
    assert.equal(report.activeCandidates, 1);
    assert.equal(report.archivedCandidates, 1);
    assert.equal(report.unresolvedLifecycleRows, 1);
    assert.equal(report.deletedSourceRows, 1);
    assert.equal(report.missingWorkspaceRows, 1);
    assert.equal(report.missingNameRows, 1);
    assert.equal(report.invalidTimeRows, 1);
    assert.equal(report.targetMappedClients, 0);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("Synthetic Active"));
    const archived = rows.find((row) => row.sourceClientId === "archived");
    assert.equal(archived?.lifecycleCandidate, "ARCHIVED");
    assert.equal(archived?.targetClientId, null);
    assert.deepEqual(rows.find((row) => row.sourceClientId === "deleted")?.issues,
      ["DELETED_SOURCE_REQUIRES_POLICY"]);
    assert.throws(() => summarizeLegacyClientIdentity([...rows, ...rows]),
      { message: "R04_DUPLICATE_CLIENT_SOURCE_ID" });
    assert.equal(summarizeLegacyClientIdentity([
      rows[0]!, { ...rows[0]!, accountScope: "other-scope",
        sourceIdentityKey: JSON.stringify(["other-scope", rows[0]!.sourceClientId]) },
    ]).physicalClientRows, 2);
  } finally { db.close(); }
});

test("R04 client target draft projects only a complete explicit ID map, without writes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, workspace_id TEXT,
      name TEXT, created_at TEXT, updated_at TEXT, archived_at TEXT, deleted_at TEXT);
      INSERT INTO clients VALUES
        ('active','workspace-a','Synthetic Active','2026-01-01T09:00:00Z',
         '2026-01-02T09:00:00Z',NULL,NULL),
        ('archived','workspace-a','Synthetic Archived','2026-01-01T09:00:00Z',
         '2026-01-02T09:00:00Z','2026-01-03T09:00:00Z',NULL);`);
    const source = readLegacyClientIdentityInSnapshot(db, "scope");
    const workspaceKey = JSON.stringify(["scope", "workspace-a"]);
    const workspaceId = "00000000-0000-4000-8000-000000000001";
    const activeId = "00000000-0000-4000-8000-000000000002";
    const archivedId = "00000000-0000-4000-8000-000000000003";
    const workspaces = new Map([[workspaceKey, workspaceId]]);
    const clients = new Map(source.map((row, index) => [row.sourceIdentityKey,
      index === 0 ? activeId : archivedId] as const));
    const projected = projectClientIdentityDrafts(source, { workspaces, clients });
    assert.equal(projected.status, "projected-draft");
    if (projected.status !== "projected-draft") return;
    assert.equal(projected.targetDraftRows, 2);
    assert.equal(projected.targetWrites, 0);
    assert.equal(projected.rows.find((row) => row.lifecycle === "ARCHIVED")?.sourceArchivedAt,
      "2026-01-03T09:00:00Z");
    assert.equal(db.prepare("SELECT count(*) AS n FROM clients").get()?.n, 2);
    const missingMap = projectClientIdentityDrafts(source,
      { workspaces, clients: new Map([[source[0]!.sourceIdentityKey, activeId]]) });
    assert.deepEqual(missingMap.status === "blocked" ? missingMap.reasons : [],
      ["CLIENT_MAPPING_MISSING"]);
    assert.equal(missingMap.targetDraftRows, 0);
    const collision = projectClientIdentityDrafts(source,
      { workspaces, clients: new Map(source.map((row) => [row.sourceIdentityKey, activeId])) });
    assert.deepEqual(collision.status === "blocked" ? collision.reasons : [],
      ["TARGET_CLIENT_COLLISION"]);
    const otherScope = { ...source[0]!, accountScope: "other-scope",
      sourceIdentityKey: JSON.stringify(["other-scope", source[0]!.sourceClientId]) };
    const workspaceCollision = projectClientIdentityDrafts([...source, otherScope], {
      workspaces: new Map([...workspaces,
        [JSON.stringify(["other-scope", "workspace-a"]), workspaceId]]),
      clients: new Map([...clients,
        [otherScope.sourceIdentityKey, "00000000-0000-4000-8000-000000000004"]]),
    });
    assert.deepEqual(workspaceCollision.status === "blocked" ? workspaceCollision.reasons : [],
      ["TARGET_WORKSPACE_COLLISION"]);
    const deleted = projectClientIdentityDrafts([
      { ...source[0]!, lifecycleCandidate: "DELETED_SOURCE",
        issues: ["DELETED_SOURCE_REQUIRES_POLICY"] },
    ], { workspaces, clients });
    assert.equal(deleted.status, "blocked");
    assert.equal(deleted.targetDraftRows, 0);
    assert.ok(!JSON.stringify(missingMap).includes("Synthetic"));
  } finally { db.close(); }
});

test("R04 direct client references preserve orphan, optional and archived-linked rows", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, archived_at TEXT, deleted_at TEXT);
      CREATE TABLE client_entries (id TEXT PRIMARY KEY, client_id TEXT);
      CREATE TABLE "synthetic""quoted" (id TEXT PRIMARY KEY, client_id TEXT);
      INSERT INTO clients VALUES ('active',NULL,NULL),('archived','2026-01-01',NULL),
        ('deleted',NULL,'2026-01-02');
      INSERT INTO client_entries VALUES ('a','active'),('b','archived'),('c','deleted'),
        ('d','missing-client'),('e',NULL);
      INSERT INTO "synthetic""quoted" VALUES ('f','archived');`);
    const report = inventoryLegacyClientReferencesInSnapshot(db, "scope");
    assert.deepEqual(report, {
      status: "requires-semantic-review", clientIdColumnTables: 2,
      physicalRowsInTheseTables: 6, linkedToKnownClientRows: 4,
      missingClientKeyRows: 1, orphanClientKeyRows: 1,
      linkedToArchivedClientRows: 2, linkedToDeletedClientRows: 1,
      lifecycleColumnsPresent: true, tablesWithMissingOrOrphanKeys: 1,
      targetMappedReferences: 0, targetWrites: 0,
    });
    assert.ok(!JSON.stringify(report).includes("missing-client"));
    assert.throws(() => inventoryLegacyClientReferencesInSnapshot(db, " "),
      { message: "R04_ACCOUNT_SCOPE_REQUIRED" });
  } finally { db.close(); }
});

test("R04 direct reference inventory rejects duplicated client owners instead of multiplying joins", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT);
      CREATE TABLE client_entries (id TEXT PRIMARY KEY, client_id TEXT);
      INSERT INTO clients VALUES ('client'),('client');
      INSERT INTO client_entries VALUES ('entry','client');`);
    assert.throws(() => inventoryLegacyClientReferencesInSnapshot(db, "scope"),
      { message: "R04_CLIENT_REFERENCE_CARDINALITY_MISMATCH" });
  } finally { db.close(); }
});

test("R04 shared book signal keeps every client's program row separate", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const rows = readLegacyProgramBooksInSnapshot(db, "scope");
    const report = summarizeProgramBooks(rows);
    assert.equal(report.physicalProgramRows, 7);
    assert.equal(report.distinctBookGroups, 2);
    assert.equal(report.crossClientBookGroups, 1);
    assert.equal(report.rowsInCrossClientBooks, 6);
    assert.equal(report.missingOwnerRows, 0);
    assert.equal(report.libraryNotObservedRows, 7);
    assert.equal(report.targetMappedPrograms, 0);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("synthetic-client-a"));
    assert.throws(() => summarizeProgramBooks([...rows, ...rows]),
      { message: "R04_DUPLICATE_PROGRAM_SOURCE_ID" });
  } finally { db.close(); }
});

test("R04 program/library ID equality is only a same/other-client hint", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE training_programs (id TEXT PRIMARY KEY, client_id TEXT,
        book_id TEXT, is_template INTEGER, deleted_at TEXT);
      CREATE TABLE training_library_programs (id TEXT PRIMARY KEY, client_id TEXT);
      INSERT INTO clients VALUES ('c1'),('c2');
      INSERT INTO training_library_programs VALUES ('b1','c1'),('b2','c2');
      INSERT INTO training_programs VALUES
        ('p1','c1','b1',0,NULL),('p2','c2','b1',1,NULL),
        ('p3','c1','b2',0,'2026-01-01'),('p4','orphan','b3',2,NULL),
        ('p5','c1','b2',0,NULL);`);
    const rows = readLegacyProgramBooksInSnapshot(db, "scope");
    const report = summarizeProgramBooks(rows);
    assert.equal(report.physicalProgramRows, 5);
    assert.equal(report.distinctBookGroups, 3);
    assert.equal(report.crossClientBookGroups, 1);
    assert.equal(report.rowsInCrossClientBooks, 2);
    assert.equal(report.singleClientMultiRowBookGroups, 1);
    assert.equal(report.missingOwnerRows, 1);
    assert.equal(report.libraryIdSameClientHints, 1);
    assert.equal(report.libraryIdOtherClientHints, 3);
    assert.equal(report.libraryIdNotFoundHints, 1);
    assert.equal(report.deletedMarkerRows, 1);
    assert.equal(report.templateMarkerRows, 1);
    assert.equal(report.invalidTemplateMarkerRows, 1);
    assert.equal(report.targetMappedPrograms, 0);
    assert.equal(report.targetWrites, 0);
  } finally { db.close(); }
});

test("R04 deleted source plan can still have a direct session and physical set rows", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("ALTER TABLE training_programs ADD COLUMN deleted_at TEXT");
    db.prepare("UPDATE training_programs SET deleted_at=? WHERE id=?")
      .run("2026-01-10T10:00:00Z", "synthetic-archived-program");
    const programs = readLegacyProgramBooksInSnapshot(db, "scope");
    const sets = readLegacySetRowsInSnapshot(db, "scope");
    const report = preflightProgramLinksInSnapshot(db, "scope", programs, sets);
    assert.equal(report.physicalSessionRows, 4);
    assert.equal(report.sessionDirectSameClientRows, 4);
    assert.equal(report.physicalPlannedWorkoutRows, 2);
    assert.equal(report.workoutDirectSameClientRows, 2);
    assert.equal(report.deletedProgramsWithDirectSessionRows, 1);
    assert.equal(report.deletedProgramsWithDirectWorkoutRows, 0);
    assert.equal(report.physicalSetRowsViaDeletedProgramSessions, 1);
    assert.equal(report.targetMappedLinks, 0);
    assert.equal(report.targetWrites, 0);
    const ledger = readSessionProgramLinkCandidatesInSnapshot(db, "scope", programs);
    const archivedSession = ledger.find((row) => row.sourceSessionId === "synthetic-archive-session");
    assert.equal(archivedSession?.linkKind, "direct-same-client");
    assert.ok(archivedSession?.reasons.includes("DELETED_PLAN_MARKER_PRESENT"));
    assert.equal(archivedSession?.targetProgramId, null);
    assert.equal(summarizeSessionProgramLinkCandidates(ledger).deletedPlanMarkerSessions, 1);
    assert.ok(!JSON.stringify(report).includes("synthetic-archive-session"));
  } finally { db.close(); }
});

test("R04 program_key and planned program_id never borrow another client's program", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE training_programs (id TEXT PRIMARY KEY, client_id TEXT, book_id TEXT);
      CREATE TABLE training_sessions (id TEXT PRIMARY KEY, client_id TEXT, program_key TEXT);
      CREATE TABLE training_workouts (id TEXT PRIMARY KEY, client_id TEXT, program_id TEXT);
      INSERT INTO clients VALUES ('c1'),('c2');
      INSERT INTO training_programs VALUES ('p1','c1','b'),('p2','c2','b'),('p3','c2','b2');
      INSERT INTO training_sessions VALUES ('s1','c1','p2'),('s2','c1','b'),
        ('s3','c2','missing'),('s4','c1','b2');
      INSERT INTO training_workouts VALUES ('w1','c1','p2'),('w2','c2','b'),
        ('w3','c1','missing'),('w4','c1','b2');`);
    const programs = readLegacyProgramBooksInSnapshot(db, "scope");
    const report = preflightProgramLinksInSnapshot(db, "scope", programs, []);
    assert.equal(report.physicalSessionRows, 4);
    assert.equal(report.sessionDirectOtherClientRows, 1);
    assert.equal(report.sessionBookSameClientHints, 1);
    assert.equal(report.sessionBookOtherClientHints, 1);
    assert.equal(report.sessionUnresolvedKeys, 1);
    assert.equal(report.physicalPlannedWorkoutRows, 4);
    assert.equal(report.workoutDirectOtherClientRows, 1);
    assert.equal(report.workoutBookSameClientHints, 1);
    assert.equal(report.workoutBookOtherClientHints, 1);
    assert.equal(report.workoutUnresolvedKeys, 1);
    assert.equal(report.targetWrites, 0);
    const ledger = readSessionProgramLinkCandidatesInSnapshot(db, "scope", programs);
    const summary = summarizeSessionProgramLinkCandidates(ledger);
    assert.equal(summary.physicalSessions, 4);
    assert.equal(summary.directOtherClient, 1);
    assert.equal(summary.bookSameClientHints, 1);
    assert.equal(summary.bookOtherClientHints, 1);
    assert.equal(summary.unresolvedKeys, 1);
    assert.equal(summary.targetMappedSessions, 0);
    assert.ok(!JSON.stringify(summary).includes("s1"));
    assert.deepEqual(ledger.find((row) => row.sourceSessionId === "s1")?.reasons,
      ["SOURCE_LINK_UNVERIFIED", "CROSS_CLIENT_PROGRAM_ID"]);
    assert.deepEqual(ledger.find((row) => row.sourceSessionId === "s2")?.reasons,
      ["SOURCE_LINK_UNVERIFIED", "BOOK_ID_ONLY_HINT"]);
    assert.deepEqual(ledger.find((row) => row.sourceSessionId === "s3")?.reasons,
      ["SOURCE_LINK_UNVERIFIED", "PROGRAM_KEY_UNRESOLVED"]);
    assert.deepEqual(ledger.find((row) => row.sourceSessionId === "s4")?.reasons,
      ["SOURCE_LINK_UNVERIFIED", "CROSS_CLIENT_BOOK_ID_HINT"]);
    assert.throws(() => summarizeSessionProgramLinkCandidates([...ledger, ...ledger]),
      { message: "R04_DUPLICATE_PROGRAM_SESSION_ID" });
  } finally { db.close(); }
});

test("R04 missing session program key stays quarantined with its source identity", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE training_sessions (id TEXT PRIMARY KEY, client_id TEXT, program_key TEXT);
      INSERT INTO training_sessions VALUES ('session','client',NULL);`);
    const candidates = readSessionProgramLinkCandidatesInSnapshot(db, "scope", []);
    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0]?.reasons,
      ["SOURCE_LINK_UNVERIFIED", "PROGRAM_KEY_MISSING"]);
    assert.equal(candidates[0]?.disposition, "BLOCKED_PENDING_SEMANTIC_REVIEW");
    assert.equal(candidates[0]?.targetProgramId, null);
    assert.equal(summarizeSessionProgramLinkCandidates(candidates).unresolvedKeys, 1);
  } finally { db.close(); }
});

test("R04 source workout is an independent owner-checked clue, not a program rewrite", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE training_programs (id TEXT PRIMARY KEY, client_id TEXT, book_id TEXT);
      CREATE TABLE training_sessions (id TEXT PRIMARY KEY, client_id TEXT,
        program_key TEXT, source_workout_id TEXT);
      CREATE TABLE training_workouts (id TEXT PRIMARY KEY, client_id TEXT, program_id TEXT);
      INSERT INTO clients VALUES ('c1'),('c2');
      INSERT INTO training_programs VALUES ('p1','c1','b1'),('p2','c2','b2');
      INSERT INTO training_workouts VALUES ('w1','c1','p1'),('w2','c2','p2'),
        ('w3','c1','p2'),('w6','c1','p1');
      INSERT INTO training_sessions VALUES
        ('s1','c1','p2','w1'),('s2','c1','unknown','w2'),
        ('s3','c1','p1','w3'),('s4','c1','unknown','w4'),
        ('s5','c1','p1',NULL),('s6','c1','p1','w6');`);
    const programs = readLegacyProgramBooksInSnapshot(db, "scope");
    const ledger = readSessionProgramLinkCandidatesInSnapshot(db, "scope", programs);
    const { signals, report } = triangulateSessionWorkoutOriginsInSnapshot(
      db, "scope", ledger, programs);
    assert.equal(report.physicalSessions, 6);
    assert.equal(report.sourceWorkoutColumnObserved, true);
    assert.equal(report.withSourceWorkoutId, 5);
    assert.equal(report.sameClientWorkoutRows, 3);
    assert.equal(report.otherClientWorkoutRows, 1);
    assert.equal(report.missingWorkoutRows, 1);
    assert.equal(report.matchingProgramKeys, 1);
    assert.equal(report.differingProgramKeys, 2);
    assert.equal(report.problemProgramLinkRows, 3);
    assert.equal(report.problemRowsWithSameClientWorkout, 1);
    assert.equal(report.problemRowsWithOwnedWorkoutProgram, 1);
    assert.equal(report.targetMappedSessions, 0);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("s1"));
    const s1 = signals.find((signal) => signal.sourceSessionKey
      === JSON.stringify(["scope", "training_sessions", "s1"]));
    assert.equal(s1?.kind, "workout-same-client");
    assert.equal(s1?.workoutProgramOwnedBySessionClient, true);
    assert.equal(s1?.programKeyAgreesWithWorkout, false);
    assert.equal(s1?.targetProgramId, null);
    assert.equal(ledger.find((row) => row.sourceSessionId === "s1")?.linkKind,
      "direct-other-client");
  } finally { db.close(); }
});

test("R04 nutrition entry identity uses frozen snapshot and catalog reference without target writes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE food_products (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_recipes (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_days (client_id TEXT, date_key TEXT, meals_json TEXT,
        PRIMARY KEY(client_id,date_key));
      INSERT INTO clients VALUES ('synthetic-client');
      INSERT INTO food_products VALUES ('product-1');`);
    const entries = [{ id: "entry-1", productId: "product-1", grams: "125,5",
      createdAt: "2026-01-01T08:00:00.000Z", calories: 10.25, protein: 1.5, fat: null, carbs: 2,
      productSnapshot: { id: "product-1", calories: 1, protein: 2, fat: 3, carbs: 4 } }];
    db.prepare("INSERT INTO nutrition_days VALUES ('synthetic-client','2026-01-01',?)").run(JSON.stringify({
      breakfast: entries, lunch: [], dinner: [], snack: [],
    }));
    const report = summarizeNutritionEntryIdentity(
      readLegacyNutritionEntryEvidenceInSnapshot(db, "scope"));
    assert.equal(report.physicalDayRows, 1);
    assert.equal(report.physicalEntryRows, 1);
    assert.equal(report.shapeCompleteButUnverifiedRows, 1);
    assert.equal(report.catalogMissingRows, 0);
    assert.equal(report.snapshotNonNumericMacroRows, 0);
    assert.equal(report.unknownEntryMacroValues, 1);
    assert.equal(report.missingUpdatedAtRows, 1);
    assert.equal(report.entryTotalsX100UnrepresentableRows, 0);
    assert.equal(report.targetMappedEntries, 0);
    assert.equal(report.targetWrites, 0);
    assert.ok(!JSON.stringify(report).includes("synthetic-client"));
  } finally { db.close(); }
});

test("R04 nutrition identity exposes repeated IDs, missing catalog and nonnumeric snapshot", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE food_products (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_recipes (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_days (client_id TEXT, date_key TEXT, meals_json TEXT,
        PRIMARY KEY(client_id,date_key));
      INSERT INTO clients VALUES ('client-a'),('client-b');`);
    const insert = db.prepare("INSERT INTO nutrition_days VALUES (?, ?, ?)");
    const meals = (productId: string, snapshot: unknown) => JSON.stringify({
      breakfast: [{ id: "reused-entry", productId, grams: "100", productSnapshot: snapshot }],
      lunch: [], dinner: [], snack: [],
    });
    insert.run("client-a", "2026-01-01", meals("missing-product", {
      id: "missing-product", calories: "100", protein: "10", fat: "2", carbs: "8",
    }));
    insert.run("client-b", "2026-01-02", meals("other-product", null));
    const report = summarizeNutritionEntryIdentity(
      readLegacyNutritionEntryEvidenceInSnapshot(db, "scope"));
    assert.equal(report.physicalEntryRows, 2);
    assert.equal(report.repeatedEntryIdRows, 1);
    assert.equal(report.crossClientRepeatedIdRows, 1);
    assert.equal(report.catalogMissingRows, 2);
    assert.equal(report.snapshotNumericStringMacroRows, 1);
    assert.equal(report.snapshotNonNumericMacroRows, 0);
    assert.equal(report.snapshotMissingRows, 1);
    assert.equal(report.shapeCompleteButUnverifiedRows, 0);
  } finally { db.close(); }
});

test("R04 nutrition identity quarantines every occurrence of a colliding complete ID", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE food_products (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_days (client_id TEXT, date_key TEXT, meals_json TEXT,
        PRIMARY KEY(client_id,date_key));
      INSERT INTO clients VALUES ('client-a');
      INSERT INTO food_products VALUES ('product-a');`);
    const entry = { id: "reused", productId: "product-a", grams: "100",
      createdAt: "2026-01-01T08:00:00Z", calories: 1, protein: 2, fat: 3, carbs: 4,
      productSnapshot: { id: "product-a", calories: 1, protein: 2, fat: 3, carbs: 4 } };
    const meals = JSON.stringify({ breakfast: [entry], lunch: [], dinner: [], snack: [] });
    const insert = db.prepare("INSERT INTO nutrition_days VALUES ('client-a', ?, ?)");
    insert.run("2026-01-01", meals);
    insert.run("2026-01-02", meals);
    const report = summarizeNutritionEntryIdentity(
      readLegacyNutritionEntryEvidenceInSnapshot(db, "scope"));
    assert.equal(report.physicalEntryRows, 2);
    assert.equal(report.repeatedEntryIdRows, 1);
    assert.equal(report.shapeCompleteButUnverifiedRows, 0);
  } finally { db.close(); }
});

test("R04 hundredth parser never rounds excess precision or collapses missing into zero", () => {
  assert.equal(exactNonnegativeHundredth("82,5"), 8250);
  assert.equal(exactNonnegativeHundredth(0), 0);
  assert.equal(exactNonnegativeHundredth(null), null);
  assert.equal(exactNonnegativeHundredth("1.005"), null);
  assert.equal(exactNonnegativeHundredth(-1), null);
  assert.equal(exactNonnegativeHundredth("9007199254740992"), null);
});

test("R04 nutrition snapshot with negative nutrient is not structurally complete", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE food_products (id TEXT PRIMARY KEY);
      CREATE TABLE nutrition_days (client_id TEXT, date_key TEXT, meals_json TEXT,
        PRIMARY KEY(client_id,date_key));
      INSERT INTO clients VALUES ('client-a');
      INSERT INTO food_products VALUES ('product-a');`);
    db.prepare("INSERT INTO nutrition_days VALUES ('client-a','2026-01-01',?)").run(JSON.stringify({
      breakfast: [{ id: "entry-a", productId: "product-a", grams: "100",
        createdAt: "2026-01-01T08:00:00Z", calories: 1, protein: 1, fat: 1, carbs: 1,
        productSnapshot: { id: "product-a", calories: -1, protein: 1, fat: 1, carbs: 1 } }],
      lunch: [], dinner: [], snack: [],
    }));
    const report = summarizeNutritionEntryIdentity(
      readLegacyNutritionEntryEvidenceInSnapshot(db, "scope"));
    assert.equal(report.snapshotNonNumericMacroRows, 1);
    assert.equal(report.shapeCompleteButUnverifiedRows, 0);
  } finally { db.close(); }
});
