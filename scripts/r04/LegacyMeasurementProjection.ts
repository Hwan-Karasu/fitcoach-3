import type { MeasurementInput, MeasurementType } from "../../apps/mobile/src/features/measurements/domain/MeasurementModel.ts";
import { isLocalDate, validateMeasurement } from "../../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { buildMeasurementValueCandidates, type MeasurementSourceField, type MeasurementValueCandidate } from "./MeasurementValueCandidates.ts";
import type { LegacyMeasurementSource } from "./LegacyMeasurementSourceReader.ts";

/** Verified against build120 KbjuMeasurementsSection/kbjuCopy and ClientMeasurementsRepository. */
const types: Readonly<Record<MeasurementSourceField, MeasurementType>> = {
  neck: "NECK", shoulders: "SHOULDERS", chest: "CHEST", waist: "WAIST", hips: "HIPS",
  upper_arm: "ARM", thigh: "THIGH", calf: "CALF",
};
type ProjectionIssue = "MISSING_OWNER" | "INVALID_DATE" | "INVALID_VALUE" | "NONPOSITIVE_VALUE" |
  "PRECISION_NOT_REPRESENTABLE" | "VALUE_OUTSIDE_TARGET_BOUNDS" | "FUTURE_DATE";
export interface MeasurementInputCandidate {
  readonly source: MeasurementValueCandidate;
  readonly rawValue: unknown;
  readonly unit: "cm";
  readonly input: MeasurementInput | null;
  readonly issues: readonly ProjectionIssue[];
  readonly targetMeasurementId: null;
  readonly dailyPrimaryId: null;
}

/** Exact positive decimal cm → tenths. Trailing zeros add no precision; never round. */
function tenths(value: string): number | null {
  const [whole, rawFraction = ""] = value.split(".");
  const fraction = rawFraction.replace(/0+$/u, "");
  if (fraction.length > 1) return null;
  const scaled = BigInt(whole!) * 10n + BigInt(fraction || "0");
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(scaled) : null;
}

/** Target-shaped inputs in memory only: keeps independent same-day and unsided observations. */
export function projectLegacyMeasurementInputs(rows: readonly LegacyMeasurementSource[], now: Date): readonly MeasurementInputCandidate[] {
  if (Number.isNaN(now.valueOf())) throw new Error("R04_MEASUREMENT_REFERENCE_TIME_INVALID");
  const rawValues = new Map<string, unknown>();
  for (const row of rows) for (const [field, value] of Object.entries(row.fieldRawValues)) {
    rawValues.set(JSON.stringify([row.accountScope, row.sourceRowId, field]), value);
  }
  return buildMeasurementValueCandidates(rows).map((source) => {
    const issues: ProjectionIssue[] = source.issues.filter((issue) => issue !== "UNIT_UNVERIFIED");
    const valueX10 = source.normalizedDecimal === null ? null : tenths(source.normalizedDecimal);
    if (source.normalizedDecimal !== null && valueX10 === null) issues.push("PRECISION_NOT_REPRESENTABLE");
    const proposed: MeasurementInput | null = valueX10 === null ? null : {
      type: types[source.sourceField], valueX10, localDate: source.localDate, localMinute: null,
    };
    if (proposed !== null && !issues.includes("INVALID_DATE")) {
      try { validateMeasurement(proposed, now); }
      catch (error) {
        if (!(error instanceof Error)) throw error;
        if (error.message === "MEASUREMENT_VALUE_INVALID") issues.push("VALUE_OUTSIDE_TARGET_BOUNDS");
        else if (error.message === "MEASUREMENT_DATE_INVALID") issues.push(isLocalDate(proposed.localDate) ? "FUTURE_DATE" : "INVALID_DATE");
        else throw error;
      }
    }
    return { source, rawValue: rawValues.get(source.sourceAtomKey), unit: "cm", input: issues.length === 0 ? proposed : null,
      issues, targetMeasurementId: null, dailyPrimaryId: null };
  });
}

export function summarizeLegacyMeasurementProjection(candidates: readonly MeasurementInputCandidate[]) {
  return {
    status: "requires-mapping" as const, sourceValues: candidates.length,
    targetInputCandidates: candidates.filter((row) => row.input !== null).length,
    valuesRequiringReview: candidates.filter((row) => row.input === null).length,
    precisionReviewValues: candidates.filter((row) => row.issues.includes("PRECISION_NOT_REPRESENTABLE")).length,
    boundsReviewValues: candidates.filter((row) => row.issues.includes("VALUE_OUTSIDE_TARGET_BOUNDS")).length,
    targetWrites: 0 as const,
  };
}
