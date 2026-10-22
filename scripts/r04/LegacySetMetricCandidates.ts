import type { TrackingProfileId } from "../../apps/mobile/src/features/exercises/domain/ExerciseModel.ts";
import type { SetValues } from "../../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";
import { preflightSourceFacts, type LegacySetSource, type SourceFactCandidate } from "./SourceFactPreflight.ts";

/** Owner-confirmed v2 convention: repetitions and working weight in kilograms. */
export const LEGACY_V2_TRACKING_PROFILE = "LOAD_REPS" satisfies TrackingProfileId;

export type LegacySetMetricIssue = "MISSING_REPS" | "INVALID_REPS" | "MISSING_WEIGHT" | "INVALID_WEIGHT";

export interface LegacySetMetricCandidate extends SourceFactCandidate {
  readonly sourceIdentityKey: string;
  readonly trackingProfile: typeof LEGACY_V2_TRACKING_PROFILE;
  readonly values: SetValues;
  readonly metricIssues: readonly LegacySetMetricIssue[];
  /** Correct metrics alone never prove that a physical legacy row is a performed fact. */
  readonly metricStatus: "exact-values" | "requires-value-review";
}

function missing(value: unknown): boolean {
  return value == null || typeof value === "string" && value.trim() === "";
}

function repetitions(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/** Exact kg → integer grams; never round a legacy value to fit the target. */
function weightGrams(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:[.,]\d+)?$/u.test(value.trim())) return null;
  const [whole, rawFraction = ""] = value.trim().replace(",", ".").split(".");
  const fraction = rawFraction.replace(/0+$/u, "");
  if (fraction.length > 3) return null;
  const grams = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return grams <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(grams) : null;
}

/** Shared exact conversion for text metrics in session rows and archived JSON. */
export function convertLegacySetMetrics(repsRaw: unknown, weightRaw: unknown) {
  const reps = repetitions(repsRaw);
  const loadGrams = weightGrams(weightRaw);
  const metricIssues: LegacySetMetricIssue[] = [];
  if (missing(repsRaw)) metricIssues.push("MISSING_REPS");
  else if (reps === null) metricIssues.push("INVALID_REPS");
  if (missing(weightRaw)) metricIssues.push("MISSING_WEIGHT");
  else if (loadGrams === null) metricIssues.push("INVALID_WEIGHT");
  const values: SetValues = { reps, loadGrams, durationSec: null, distanceM: null };
  return { values, metricIssues };
}

/** In-memory R04 conversion only: source retained, no IDs assigned, facts confirmed or DB writes. */
export function buildLegacySetMetricCandidates(
  rows: readonly LegacySetSource[],
): readonly LegacySetMetricCandidate[] {
  return preflightSourceFacts(rows).map((candidate) => {
    const { source } = candidate;
    const { values, metricIssues } = convertLegacySetMetrics(source.repsRaw, source.weightRaw);
    return {
      ...candidate,
      sourceIdentityKey: JSON.stringify([source.accountScope, "training_session_sets", source.sourceRowId]),
      trackingProfile: LEGACY_V2_TRACKING_PROFILE,
      values,
      metricIssues,
      metricStatus: metricIssues.length === 0 ? "exact-values" : "requires-value-review",
    };
  });
}

export interface LegacySetMetricReport {
  readonly status: "requires-semantic-review";
  readonly trackingProfile: typeof LEGACY_V2_TRACKING_PROFILE;
  readonly sourceRows: number;
  readonly exactValueRows: number;
  readonly requiresValueReviewRows: number;
  readonly issueRowCounts: Readonly<Record<LegacySetMetricIssue, number>>;
  readonly targetWrites: 0;
}

/** Only counts and fixed codes leave the audit: no client IDs, names or metric values. */
export function summarizeLegacySetMetrics(rows: readonly LegacySetSource[]): LegacySetMetricReport {
  const candidates = buildLegacySetMetricCandidates(rows);
  const issueRowCounts: Record<LegacySetMetricIssue, number> = {
    MISSING_REPS: 0, INVALID_REPS: 0, MISSING_WEIGHT: 0, INVALID_WEIGHT: 0,
  };
  for (const candidate of candidates) {
    for (const issue of candidate.metricIssues) issueRowCounts[issue] += 1;
  }
  const exactValueRows = candidates.filter((candidate) => candidate.metricStatus === "exact-values").length;
  return {
    status: "requires-semantic-review", trackingProfile: LEGACY_V2_TRACKING_PROFILE,
    sourceRows: rows.length, exactValueRows,
    requiresValueReviewRows: rows.length - exactValueRows,
    issueRowCounts, targetWrites: 0,
  };
}
