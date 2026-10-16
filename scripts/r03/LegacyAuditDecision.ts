import type { LegacyRelationAudit } from "./LegacyRelationAudit.ts";
import type { LegacySemanticScreen } from "./LegacySemanticScreen.ts";
import type { SourceFactCollisionAudit } from "./SourceFactCollisionAudit.ts";

export type LegacyAuditReason =
  | "SOURCE_FACTS_UNVERIFIED"
  | "SOURCE_FACT_ID_REUSED"
  | "SOURCE_FACT_METRICS_CONFLICT"
  | "SOURCE_RELATIONS_BROKEN"
  | "SOURCE_RELATIONS_INCOMPLETE"
  | "SOURCE_SEMANTIC_COVERAGE_INCOMPLETE"
  | "SOURCE_HISTORY_NOT_ONE_TO_ONE"
  | "SOURCE_EXERCISES_WITHOUT_SET_ROWS";

export interface LegacyAuditDecision {
  readonly status: "requires-semantic-review";
  readonly reasons: readonly LegacyAuditReason[];
}

/** This screen has no authority to certify a 2.0 row as a genuine performed fact. */
export function decideLegacyAudit(
  collisions: SourceFactCollisionAudit,
  relations: LegacyRelationAudit,
  semantics: LegacySemanticScreen,
): LegacyAuditDecision {
  const reasons: LegacyAuditReason[] = ["SOURCE_FACTS_UNVERIFIED"];
  if (collisions.duplicateGroups > 0) reasons.push("SOURCE_FACT_ID_REUSED");
  if (collisions.metricConflictGroups > 0) reasons.push("SOURCE_FACT_METRICS_CONFLICT");
  if (relations.findings.some((finding) => (finding.sourceRows ?? 0) > 0)) reasons.push("SOURCE_RELATIONS_BROKEN");
  if (relations.findings.some((finding) => !finding.available)) reasons.push("SOURCE_RELATIONS_INCOMPLETE");
  if (semantics.coverage === "incomplete-shape") reasons.push("SOURCE_SEMANTIC_COVERAGE_INCOMPLETE");
  if ((semantics.historyWithoutMatchingSet ?? 0) > 0 ||
      (semantics.historyMatchingMultipleSets ?? 0) > 0) reasons.push("SOURCE_HISTORY_NOT_ONE_TO_ONE");
  if ((semantics.exercisesWithoutSets ?? 0) > 0) reasons.push("SOURCE_EXERCISES_WITHOUT_SET_ROWS");
  return { status: "requires-semantic-review", reasons };
}
