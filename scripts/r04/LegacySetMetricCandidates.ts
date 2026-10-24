import { LEGACY_V2_TRACKING_PROFILE } from "../../apps/mobile/src/shared/migration/LegacyValues.ts";
import type { SetValues } from "../../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";
import { preflightSourceFacts, type LegacySetSource, type SourceFactCandidate } from "./SourceFactPreflight.ts";

export { LEGACY_V2_TRACKING_PROFILE };

import { convertLegacySetMetrics, type LegacySetMetricIssue } from "../../apps/mobile/src/shared/migration/LegacySetMetricConversion.ts";
export { convertLegacySetMetrics, type LegacySetMetricIssue };

export interface LegacySetMetricCandidate extends SourceFactCandidate {
  readonly sourceIdentityKey: string;
  readonly trackingProfile: typeof LEGACY_V2_TRACKING_PROFILE;
  readonly values: SetValues;
  readonly metricIssues: readonly LegacySetMetricIssue[];
  /** Correct metrics alone never prove that a physical legacy row is a performed fact. */
  readonly metricStatus: "exact-values" | "requires-value-review";
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
