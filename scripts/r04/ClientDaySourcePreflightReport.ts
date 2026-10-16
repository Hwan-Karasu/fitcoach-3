import type { LegacyClientDaySource, LegacyNumericStatus } from "./LegacyClientDaySourceReader.ts";

export interface ClientDaySourcePreflightReport {
  readonly status: "requires-semantic-review";
  readonly physicalRows: number;
  readonly missingOwnerRows: number;
  readonly invalidDateRows: number;
  readonly weightPresentRows: number;
  readonly weightCommaRows: number;
  readonly weightInvalidRows: number;
  readonly stepsPresentRows: number;
  readonly stepsInvalidRows: number;
  readonly trainingYesRows: number;
  readonly trainingNoRows: number;
  readonly trainingMissingRows: number;
  readonly trainingUnknownRows: number;
  readonly workoutFactsCreated: 0;
  readonly measurementsCreated: 0;
  readonly targetWrites: 0;
}

function countNumber(status: LegacyNumericStatus): boolean {
  return status === "decimal-dot" || status === "decimal-comma";
}

/** Aggregates source text only; no inferred weight unit, workout, or zero for missing. */
export function summarizeClientDaySource(
  rows: readonly LegacyClientDaySource[],
): ClientDaySourcePreflightReport {
  const seen = new Set<string>();
  const report = {
    status: "requires-semantic-review" as const, physicalRows: rows.length,
    missingOwnerRows: 0, invalidDateRows: 0,
    weightPresentRows: 0, weightCommaRows: 0, weightInvalidRows: 0,
    stepsPresentRows: 0, stepsInvalidRows: 0,
    trainingYesRows: 0, trainingNoRows: 0,
    trainingMissingRows: 0, trainingUnknownRows: 0,
    workoutFactsCreated: 0 as const, measurementsCreated: 0 as const,
    targetWrites: 0 as const,
  };
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.clientId.trim() || !row.dateKey.trim()) {
      throw new Error("R04_CLIENT_DAY_PROVENANCE_INCOMPLETE");
    }
    const key = JSON.stringify([row.accountScope, row.clientId, row.dateKey]);
    if (seen.has(key)) throw new Error("R04_DUPLICATE_CLIENT_DAY_KEY");
    seen.add(key);
    if (!row.ownerFound) report.missingOwnerRows += 1;
    if (!row.validLocalDate) report.invalidDateRows += 1;
    if (countNumber(row.weightStatus)) report.weightPresentRows += 1;
    if (row.weightStatus === "decimal-comma") report.weightCommaRows += 1;
    if (row.weightStatus === "invalid" || row.weightStatus === "negative") report.weightInvalidRows += 1;
    if (countNumber(row.stepsStatus)) report.stepsPresentRows += 1;
    if (row.stepsStatus === "invalid" || row.stepsStatus === "negative") report.stepsInvalidRows += 1;
    if (row.trainingStatus === "yes") report.trainingYesRows += 1;
    else if (row.trainingStatus === "no") report.trainingNoRows += 1;
    else if (row.trainingStatus === "missing") report.trainingMissingRows += 1;
    else report.trainingUnknownRows += 1;
  }
  if (report.trainingYesRows + report.trainingNoRows + report.trainingMissingRows
    + report.trainingUnknownRows !== rows.length) throw new Error("R04_CLIENT_DAY_CLASSIFICATION_INCOMPLETE");
  return report;
}
