import { legacyMeasurementFields, type LegacyMeasurementSource } from "./LegacyMeasurementSourceReader.ts";

export interface MeasurementSourcePreflightReport {
  readonly status: "requires-semantic-review";
  readonly physicalRows: number;
  readonly sameClientDateGroupsWithMultipleRows: number;
  readonly missingOwnerRows: number;
  readonly invalidDateRows: number;
  readonly emptyRows: number;
  readonly numericValues: number;
  readonly commaDecimalValues: number;
  readonly invalidValues: number;
  readonly nonpositiveValues: number;
  readonly unitUnverifiedValues: number;
  readonly targetWrites: 0;
}

/** No unit or primary-day selection is inferred from the old wide row. */
export function summarizeMeasurementSource(
  rows: readonly LegacyMeasurementSource[],
): MeasurementSourcePreflightReport {
  const seen = new Set<string>();
  const groups = new Map<string, number>();
  const result = {
    status: "requires-semantic-review" as const, physicalRows: rows.length,
    sameClientDateGroupsWithMultipleRows: 0, missingOwnerRows: 0,
    invalidDateRows: 0, emptyRows: 0, numericValues: 0,
    commaDecimalValues: 0, invalidValues: 0, nonpositiveValues: 0,
    unitUnverifiedValues: 0, targetWrites: 0 as const,
  };
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.sourceRowId.trim() || !row.clientId.trim()
      || !row.dateKey.trim()) throw new Error("R04_MEASUREMENT_PROVENANCE_INCOMPLETE");
    const physicalKey = JSON.stringify([row.accountScope, row.sourceRowId]);
    if (seen.has(physicalKey)) throw new Error("R04_DUPLICATE_MEASUREMENT_ROW_ID");
    seen.add(physicalKey);
    const groupKey = JSON.stringify([row.accountScope, row.clientId, row.dateKey]);
    groups.set(groupKey, (groups.get(groupKey) ?? 0) + 1);
    if (!row.ownerFound) result.missingOwnerRows += 1;
    if (!row.validLocalDate) result.invalidDateRows += 1;
    let populated = 0;
    for (const field of legacyMeasurementFields) {
      const status = row.fieldStatuses[field];
      if (status === "missing") continue;
      populated += 1;
      if (status === "decimal-dot" || status === "decimal-comma") {
        result.numericValues += 1;
        if (status === "decimal-comma") result.commaDecimalValues += 1;
      } else if (status === "invalid") result.invalidValues += 1;
      else result.nonpositiveValues += 1;
    }
    if (populated === 0) result.emptyRows += 1;
  }
  result.sameClientDateGroupsWithMultipleRows = [...groups.values()].filter((count) => count > 1).length;
  result.unitUnverifiedValues = result.numericValues;
  return result;
}
