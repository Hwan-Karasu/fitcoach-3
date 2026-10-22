import assert from "node:assert/strict";
import test from "node:test";
import { projectLegacyMeasurementInputs, summarizeLegacyMeasurementProjection } from "./r04/LegacyMeasurementProjection.ts";
import { legacyMeasurementFields, type LegacyMeasurementSource } from "./r04/LegacyMeasurementSourceReader.ts";

const now = new Date("2026-10-22T12:00:00Z");
function source(value = "35,5"): LegacyMeasurementSource {
  return {
    accountScope: "synthetic-account", sourceRowId: "synthetic-row", clientId: "synthetic-client", dateKey: "2026-01-01",
    ownerFound: true, validLocalDate: true,
    fieldStatuses: Object.fromEntries(legacyMeasurementFields.map((field) => [field, value.includes(",") ? "decimal-comma" : "decimal-dot"])) as LegacyMeasurementSource["fieldStatuses"],
    fieldRawValues: Object.fromEntries(legacyMeasurementFields.map((field) => [field, value])) as LegacyMeasurementSource["fieldRawValues"],
  };
}

test("all eight verified centimetre fields project to exact target tenths", () => {
  const result = projectLegacyMeasurementInputs([source()], now);
  assert.equal(result.length, 8);
  assert.deepEqual(result.map((row) => row.input?.type), ["NECK", "SHOULDERS", "CHEST", "WAIST", "HIPS", "ARM", "THIGH", "CALF"]);
  assert.ok(result.every((row) => row.input?.valueX10 === 355 && row.unit === "cm" && row.rawValue === "35,5"));
});

test("trailing zeros retain exact precision while excess precision is never rounded", () => {
  assert.ok(projectLegacyMeasurementInputs([source("35.5000")], now).every((row) => row.input?.valueX10 === 355));
  const result = projectLegacyMeasurementInputs([source("35.55")], now);
  assert.ok(result.every((row) => row.input === null && row.rawValue === "35.55" && row.issues.includes("PRECISION_NOT_REPRESENTABLE")));
});

test("unsided arm/thigh/calf never create invented left/right observations", () => {
  const result = projectLegacyMeasurementInputs([source()], now);
  assert.ok(result.every((row) => !row.input?.type.endsWith("_L") && !row.input?.type.endsWith("_R")));
  assert.ok(result.every((row) => row.input?.localMinute === null && row.targetMeasurementId === null && row.dailyPrimaryId === null));
});

test("same-day observations remain independent even with equal values", () => {
  const result = projectLegacyMeasurementInputs([source(), { ...source(), sourceRowId: "synthetic-second" }], now);
  assert.equal(result.length, 16);
  assert.equal(new Set(result.map((row) => row.source.sourceAtomKey)).size, 16);
});

test("empty fields do not become zero observations", () => {
  const row = source();
  const empty: LegacyMeasurementSource = { ...row,
    fieldStatuses: { ...row.fieldStatuses, neck: "missing" }, fieldRawValues: { ...row.fieldRawValues, neck: "" } };
  assert.equal(projectLegacyMeasurementInputs([empty], now).length, 7);
});

test("target bounds block implausible values without clipping or dropping source", () => {
  const result = projectLegacyMeasurementInputs([source("999")], now);
  assert.equal(result.length, 8);
  assert.ok(result.every((row) => row.input === null && row.issues.includes("VALUE_OUTSIDE_TARGET_BOUNDS") && row.rawValue === "999"));
});

test("zero and invalid values remain review candidates, distinct from empty values", () => {
  const row = source();
  const invalid: LegacyMeasurementSource = { ...row,
    fieldStatuses: { ...row.fieldStatuses, neck: "nonpositive", waist: "invalid" },
    fieldRawValues: { ...row.fieldRawValues, neck: "0", waist: "bad" } };
  const result = projectLegacyMeasurementInputs([invalid], now);
  assert.equal(result.length, 8);
  assert.ok(result.find((entry) => entry.source.sourceField === "neck")?.issues.includes("NONPOSITIVE_VALUE"));
  assert.equal(result.find((entry) => entry.source.sourceField === "waist")?.rawValue, "bad");
});

test("owner, malformed date and future date are independent review reasons", () => {
  assert.ok(projectLegacyMeasurementInputs([{ ...source(), ownerFound: false }], now).every((row) => row.input === null && row.issues.includes("MISSING_OWNER")));
  assert.ok(projectLegacyMeasurementInputs([{ ...source(), validLocalDate: false, dateKey: "bad" }], now).every((row) => row.issues.includes("INVALID_DATE")));
  assert.ok(projectLegacyMeasurementInputs([{ ...source(), dateKey: "2027-01-01" }], now).every((row) => row.issues.includes("FUTURE_DATE")));
});

test("out-of-range precision never overflows or fabricates a supported value", () => {
  const result = projectLegacyMeasurementInputs([source("999999999999999999999999")], now);
  assert.ok(result.every((row) => row.input === null && row.issues.includes("PRECISION_NOT_REPRESENTABLE")));
  assert.throws(() => projectLegacyMeasurementInputs([source()], new Date("bad")), /REFERENCE_TIME_INVALID/u);
});

test("aggregate reports only counts and does not expose patient values or source IDs", () => {
  const report = summarizeLegacyMeasurementProjection(projectLegacyMeasurementInputs([source()], now));
  assert.deepEqual(report, { status: "requires-mapping", sourceValues: 8, targetInputCandidates: 8,
    valuesRequiringReview: 0, precisionReviewValues: 0, boundsReviewValues: 0, targetWrites: 0 });
  assert.doesNotMatch(JSON.stringify(report), /synthetic|35|clientId|rawValue|valueX10/u);
});
