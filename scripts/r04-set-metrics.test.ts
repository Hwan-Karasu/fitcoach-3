import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacySetMetricCandidates, summarizeLegacySetMetrics } from "./r04/LegacySetMetricCandidates.ts";
import type { LegacySetSource } from "./r04/SourceFactPreflight.ts";

const row: LegacySetSource = {
  accountScope: "synthetic-account", sourceRowId: "synthetic-set",
  clientId: "synthetic-client", programId: "synthetic-program",
  sessionId: "synthetic-session", sessionExerciseId: "synthetic-exercise",
  sourceFactId: "synthetic-fact", repsRaw: "20", weightRaw: "10",
};

test("v2 20 × 10 kg preserves repetitions and converts kilograms to target grams", () => {
  const input = Object.freeze({ ...row });
  const [candidate] = buildLegacySetMetricCandidates([input]);
  assert.equal(candidate?.trackingProfile, "LOAD_REPS");
  assert.deepEqual(candidate?.values, { reps: 20, loadGrams: 10000, durationSec: null, distanceM: null });
  assert.equal(candidate?.metricStatus, "exact-values");
  assert.deepEqual(candidate?.source, row);
  assert.equal(input.weightRaw, "10");
  assert.equal(candidate?.disposition, "BLOCKED_PENDING_SEMANTIC_REVIEW");
});

test("decimal comma, fractional kg and trailing zero precision convert without float rounding", () => {
  for (const [weightRaw, grams] of [[" 2,125 ", 2125], ["0.29", 290], ["1.0000", 1000], ["0.001", 1]] as const) {
    const [candidate] = buildLegacySetMetricCandidates([{ ...row, weightRaw }]);
    assert.equal(candidate?.values.loadGrams, grams);
    assert.equal(candidate?.source.weightRaw, weightRaw);
    assert.deepEqual(candidate?.metricIssues, []);
  }
});

test("explicit zero load is retained and differs from missing weight", () => {
  const [zero] = buildLegacySetMetricCandidates([{ ...row, weightRaw: "0" }]);
  assert.equal(zero?.values.loadGrams, 0);
  assert.equal(zero?.metricStatus, "exact-values");
  for (const weightRaw of [null, "", "  "]) {
    const [missing] = buildLegacySetMetricCandidates([{ ...row, weightRaw }]);
    assert.equal(missing?.values.loadGrams, null);
    assert.equal(missing?.values.reps, 20);
    assert.deepEqual(missing?.metricIssues, ["MISSING_WEIGHT"]);
    assert.equal(missing?.source.weightRaw, weightRaw);
  }
});

test("missing repetitions preserve valid weight without inventing reps", () => {
  for (const repsRaw of [null, "", " "]) {
    const [candidate] = buildLegacySetMetricCandidates([{ ...row, repsRaw }]);
    assert.deepEqual(candidate?.values, { reps: null, loadGrams: 10000, durationSec: null, distanceM: null });
    assert.deepEqual(candidate?.metricIssues, ["MISSING_REPS"]);
  }
});

test("invalid, fractional, zero and unsafe repetitions remain reviewable source data", () => {
  for (const repsRaw of ["0", "-1", "1.5", "20×10", "10-12", "Infinity", "9007199254740992"]) {
    const [candidate] = buildLegacySetMetricCandidates([{ ...row, repsRaw }]);
    assert.equal(candidate?.values.reps, null);
    assert.equal(candidate?.values.loadGrams, 10000);
    assert.equal(candidate?.source.repsRaw, repsRaw);
    assert.deepEqual(candidate?.metricIssues, ["INVALID_REPS"]);
  }
});

test("invalid weight, units, ranges and subgram precision are never guessed or rounded", () => {
  for (const weightRaw of ["-10", "10 кг", "10-20", "1e2", "NaN", "1.0001", "9007199254741"]) {
    const [candidate] = buildLegacySetMetricCandidates([{ ...row, weightRaw }]);
    assert.equal(candidate?.values.loadGrams, null);
    assert.equal(candidate?.source.weightRaw, weightRaw);
    assert.deepEqual(candidate?.metricIssues, ["INVALID_WEIGHT"]);
  }
});

test("exact grams accept the safe integer boundary and reject its next gram", () => {
  const [safe] = buildLegacySetMetricCandidates([{ ...row, weightRaw: "9007199254740.991" }]);
  const [unsafe] = buildLegacySetMetricCandidates([{ ...row, weightRaw: "9007199254740.992" }]);
  assert.equal(safe?.values.loadGrams, Number.MAX_SAFE_INTEGER);
  assert.equal(unsafe?.values.loadGrams, null);
});

test("matching metrics never deduplicate cross-client or cross-session facts", () => {
  const candidates = buildLegacySetMetricCandidates([
    row, { ...row, sourceRowId: "synthetic-other", clientId: "synthetic-other-client", sessionId: "synthetic-other-session" },
  ]);
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) {
    assert.equal(candidate.metricStatus, "exact-values");
    assert.equal(candidate.disposition, "BLOCKED_PENDING_SEMANTIC_REVIEW");
    assert.ok(candidate.reviewReasons.includes("CROSS_CLIENT_SOURCE_FACT_ID"));
    assert.ok(candidate.reviewReasons.includes("CROSS_SESSION_SOURCE_FACT_ID"));
  }
});

test("source identity remains account scoped and duplicate physical rows are rejected", () => {
  assert.throws(() => buildLegacySetMetricCandidates([row, row]), /R04_DUPLICATE_PHYSICAL_ROW_ID/u);
  assert.throws(() => buildLegacySetMetricCandidates([{ ...row, clientId: "" }]), /R04_SOURCE_PROVENANCE_INCOMPLETE/u);
  const candidates = buildLegacySetMetricCandidates([row, { ...row, accountScope: "synthetic-other-account" }]);
  assert.notEqual(candidates[0]?.sourceIdentityKey, candidates[1]?.sourceIdentityKey);
});

test("completion and deletion markers remain unchanged; metric conversion does not confirm a fact", () => {
  const source = {
    ...row, lifecycleShapeComplete: true, completedAtRaw: "2026-01-01T10:00:00Z",
    performedAtRaw: "2026-01-01T10:00:00Z", setDeletedAtRaw: "2026-01-02T10:00:00Z",
  };
  const [candidate] = buildLegacySetMetricCandidates([source]);
  assert.deepEqual(candidate?.source, source);
  assert.equal(candidate?.disposition, "BLOCKED_PENDING_SEMANTIC_REVIEW");
  assert.ok(candidate?.reviewReasons.includes("SET_DELETION_MARKER_PRESENT"));
});

test("aggregate report accounts for every row without exposing source identities or values", () => {
  const report = summarizeLegacySetMetrics([
    row, { ...row, sourceRowId: "synthetic-missing", repsRaw: null, weightRaw: "" },
    { ...row, sourceRowId: "synthetic-invalid", repsRaw: "1.5", weightRaw: "-1" },
  ]);
  assert.deepEqual(report, {
    status: "requires-semantic-review", trackingProfile: "LOAD_REPS", sourceRows: 3,
    exactValueRows: 1, requiresValueReviewRows: 2,
    issueRowCounts: { MISSING_REPS: 1, INVALID_REPS: 1, MISSING_WEIGHT: 1, INVALID_WEIGHT: 1 }, targetWrites: 0,
  });
  assert.doesNotMatch(JSON.stringify(report), /synthetic|repsRaw|weightRaw|loadGrams/u);
  assert.equal(summarizeLegacySetMetrics([]).sourceRows, 0);
});
