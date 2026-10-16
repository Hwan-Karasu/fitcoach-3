import type { LegacyNutritionEntryEvidence } from "./LegacyNutritionEntrySourceReader.ts";

export interface NutritionEntryIdentityReport {
  readonly status: "requires-semantic-review";
  readonly physicalDayRows: number;
  readonly unparsedDayRows: number;
  readonly physicalEntryRows: number;
  readonly missingEntryIdRows: number;
  readonly repeatedEntryIdRows: number;
  readonly crossClientRepeatedIdRows: number;
  readonly missingOwnerOrInvalidDateRows: number;
  readonly missingOrAmbiguousReferenceRows: number;
  readonly catalogMissingRows: number;
  readonly catalogNotInspectedRows: number;
  readonly snapshotMissingRows: number;
  readonly snapshotIdMismatchRows: number;
  readonly snapshotNonNumericMacroRows: number;
  readonly snapshotNumericStringMacroRows: number;
  readonly invalidGramsRows: number;
  readonly amountX100UnrepresentableRows: number;
  readonly entryTotalsX100UnrepresentableRows: number;
  readonly unknownEntryMacroValues: number;
  readonly missingEnteredAtRows: number;
  readonly missingUpdatedAtRows: number;
  readonly shapeCompleteButUnverifiedRows: number;
  readonly targetMappedEntries: 0;
  readonly targetWrites: 0;
}

/** Same entry ID across clients/days is evidence of collision, not an N→1 merge rule. */
export function summarizeNutritionEntryIdentity(
  evidence: LegacyNutritionEntryEvidence,
): NutritionEntryIdentityReport {
  const ids = new Map<string, string>();
  const idCounts = new Map<string, number>();
  for (const row of evidence.entries) {
    if (row.sourceEntryId === null) continue;
    const key = JSON.stringify([row.accountScope, row.sourceEntryId]);
    idCounts.set(key, (idCounts.get(key) ?? 0) + 1);
  }
  const result = {
    status: "requires-semantic-review" as const,
    physicalDayRows: evidence.physicalDayRows,
    unparsedDayRows: evidence.unparsedDayRows,
    physicalEntryRows: evidence.entries.length,
    missingEntryIdRows: 0, repeatedEntryIdRows: 0, crossClientRepeatedIdRows: 0,
    missingOwnerOrInvalidDateRows: 0, missingOrAmbiguousReferenceRows: 0,
    catalogMissingRows: 0, catalogNotInspectedRows: 0,
    snapshotMissingRows: 0, snapshotIdMismatchRows: 0,
    snapshotNonNumericMacroRows: 0, snapshotNumericStringMacroRows: 0,
    invalidGramsRows: 0, amountX100UnrepresentableRows: 0,
    entryTotalsX100UnrepresentableRows: 0, unknownEntryMacroValues: 0,
    missingEnteredAtRows: 0, missingUpdatedAtRows: 0,
    shapeCompleteButUnverifiedRows: 0,
    targetMappedEntries: 0 as const, targetWrites: 0 as const,
  };
  for (const row of evidence.entries) {
    if (!row.accountScope.trim() || !row.clientId.trim() || !row.dateKey.trim()) {
      throw new Error("R04_NUTRITION_PROVENANCE_INCOMPLETE");
    }
    if (row.sourceEntryId === null) result.missingEntryIdRows += 1;
    else {
      const key = JSON.stringify([row.accountScope, row.sourceEntryId]);
      const previousClient = ids.get(key);
      if (previousClient !== undefined) {
        result.repeatedEntryIdRows += 1;
        if (previousClient !== row.clientId) result.crossClientRepeatedIdRows += 1;
      } else ids.set(key, row.clientId);
    }
    if (!row.ownerFound) result.missingOwnerOrInvalidDateRows += 1;
    if (row.referenceKind === "missing" || row.referenceKind === "both") {
      result.missingOrAmbiguousReferenceRows += 1;
    }
    if (row.catalogReference === "missing" && row.referenceKind !== "missing"
      && row.referenceKind !== "both") result.catalogMissingRows += 1;
    if (row.catalogReference === "not-inspected") result.catalogNotInspectedRows += 1;
    if (row.snapshotReference === "missing") result.snapshotMissingRows += 1;
    if (row.snapshotReference === "mismatch") result.snapshotIdMismatchRows += 1;
    if (row.snapshotMacros === "non-numeric") result.snapshotNonNumericMacroRows += 1;
    if (row.snapshotMacros === "numeric-strings") result.snapshotNumericStringMacroRows += 1;
    if (!row.positiveGrams) result.invalidGramsRows += 1;
    if (!row.amountX100Representable) result.amountX100UnrepresentableRows += 1;
    if (!row.entryTotalsX100Representable) result.entryTotalsX100UnrepresentableRows += 1;
    result.unknownEntryMacroValues += row.unknownEntryMacroValues;
    if (!row.enteredAtPresent) result.missingEnteredAtRows += 1;
    if (!row.updatedAtPresent) result.missingUpdatedAtRows += 1;
    if (row.sourceEntryId !== null
      && idCounts.get(JSON.stringify([row.accountScope, row.sourceEntryId])) === 1
      && row.ownerFound
      && (row.referenceKind === "product" || row.referenceKind === "recipe")
      && row.catalogReference === "found" && row.snapshotReference === "matches"
      && row.snapshotMacros === "numeric" && row.positiveGrams
      && row.amountX100Representable && row.entryTotalsX100Representable
      && row.enteredAtPresent) {
      result.shapeCompleteButUnverifiedRows += 1;
    }
  }
  return result;
}
