import {
  legacyMeasurementFields,
  type LegacyMeasurementSource,
} from "./LegacyMeasurementSourceReader.ts";

export type MeasurementSourceField = typeof legacyMeasurementFields[number];
export type MeasurementCandidateIssue =
  "MISSING_OWNER" | "INVALID_DATE" | "INVALID_VALUE" |
  "NONPOSITIVE_VALUE" | "UNIT_UNVERIFIED";

export interface MeasurementValueCandidate {
  readonly sourceAtomKey: string;
  readonly accountScope: string;
  readonly sourceRowId: string;
  readonly clientId: string;
  readonly localDate: string;
  readonly sourceField: MeasurementSourceField;
  /** Exact source decimal text, with comma normalized; no binary rounding or unit conversion. */
  readonly normalizedDecimal: string | null;
  readonly datePrecision: "DATE";
  readonly measuredAt: null;
  readonly issues: readonly MeasurementCandidateIssue[];
  readonly targetMeasurementId: null;
}

function normalizedDecimal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+(?:[.,]\d+)?$/u.test(trimmed) ? trimmed.replace(",", ".") : null;
}

/** Expands one wide source row without assigning target IDs, units, primary, or exact time. */
export function buildMeasurementValueCandidates(
  rows: readonly LegacyMeasurementSource[],
): readonly MeasurementValueCandidate[] {
  const seenRows = new Set<string>();
  const candidates: MeasurementValueCandidate[] = [];
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.sourceRowId.trim() || !row.clientId.trim()
      || !row.dateKey.trim()) throw new Error("R04_MEASUREMENT_PROVENANCE_INCOMPLETE");
    const rowKey = JSON.stringify([row.accountScope, row.sourceRowId]);
    if (seenRows.has(rowKey)) throw new Error("R04_DUPLICATE_MEASUREMENT_ROW_ID");
    seenRows.add(rowKey);
    for (const field of legacyMeasurementFields) {
      const status = row.fieldStatuses[field];
      if (status === "missing") continue;
      const numeric = status === "decimal-dot" || status === "decimal-comma";
      const decimal = numeric ? normalizedDecimal(row.fieldRawValues[field]) : null;
      if (numeric && decimal === null) throw new Error("R04_MEASUREMENT_STATUS_VALUE_MISMATCH");
      const issues: MeasurementCandidateIssue[] = [];
      if (!row.ownerFound) issues.push("MISSING_OWNER");
      if (!row.validLocalDate) issues.push("INVALID_DATE");
      if (status === "invalid") issues.push("INVALID_VALUE");
      else if (status === "nonpositive") issues.push("NONPOSITIVE_VALUE");
      else issues.push("UNIT_UNVERIFIED");
      candidates.push({
        sourceAtomKey: JSON.stringify([row.accountScope, row.sourceRowId, field]),
        accountScope: row.accountScope, sourceRowId: row.sourceRowId,
        clientId: row.clientId, localDate: row.dateKey, sourceField: field,
        normalizedDecimal: decimal, datePrecision: "DATE", measuredAt: null,
        issues, targetMeasurementId: null,
      });
    }
  }
  return candidates;
}

export interface MeasurementCandidateSummary {
  readonly status: "requires-semantic-review";
  readonly sourceValues: number;
  readonly exactDecimalCandidates: number;
  readonly invalidValueCandidates: number;
  readonly missingOwnerCandidates: number;
  readonly invalidDateCandidates: number;
  readonly targetMappedValues: 0;
  readonly targetWrites: 0;
}

/** Safe aggregate: no source values, IDs or client keys leave the preflight. */
export function summarizeMeasurementValueCandidates(
  candidates: readonly MeasurementValueCandidate[],
): MeasurementCandidateSummary {
  return {
    status: "requires-semantic-review",
    sourceValues: candidates.length,
    exactDecimalCandidates: candidates.filter((item) => item.normalizedDecimal !== null
      && item.issues.includes("UNIT_UNVERIFIED")).length,
    invalidValueCandidates: candidates.filter((item) => item.issues.includes("INVALID_VALUE")
      || item.issues.includes("NONPOSITIVE_VALUE")).length,
    missingOwnerCandidates: candidates.filter((item) => item.issues.includes("MISSING_OWNER")).length,
    invalidDateCandidates: candidates.filter((item) => item.issues.includes("INVALID_DATE")).length,
    targetMappedValues: 0,
    targetWrites: 0,
  };
}
