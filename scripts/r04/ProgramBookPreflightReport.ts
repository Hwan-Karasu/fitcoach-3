import type { LegacyProgramBookSource } from "./LegacyProgramBookSourceReader.ts";

export interface ProgramBookPreflightReport {
  readonly status: "requires-semantic-review";
  readonly physicalProgramRows: number;
  readonly missingOwnerRows: number;
  readonly rowsWithoutBookId: number;
  readonly distinctBookGroups: number;
  readonly crossClientBookGroups: number;
  readonly rowsInCrossClientBooks: number;
  readonly singleClientMultiRowBookGroups: number;
  readonly libraryIdSameClientHints: number;
  readonly libraryIdOtherClientHints: number;
  readonly libraryIdNotFoundHints: number;
  readonly libraryNotObservedRows: number;
  readonly deletedMarkerRows: number;
  readonly templateMarkerRows: number;
  readonly invalidTemplateMarkerRows: number;
  readonly targetMappedPrograms: 0;
  readonly targetWrites: 0;
}

/** Book equality is only a source grouping signal, never a merge decision. */
export function summarizeProgramBooks(
  rows: readonly LegacyProgramBookSource[],
): ProgramBookPreflightReport {
  const seenPrograms = new Set<string>();
  const groups = new Map<string, { rows: number; clients: Set<string> }>();
  let missingOwnerRows = 0;
  let rowsWithoutBookId = 0;
  let libraryIdSameClientHints = 0;
  let libraryIdOtherClientHints = 0;
  let libraryIdNotFoundHints = 0;
  let libraryNotObservedRows = 0;
  let deletedMarkerRows = 0;
  let templateMarkerRows = 0;
  let invalidTemplateMarkerRows = 0;
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.sourceProgramId.trim() || !row.clientId.trim()) {
      throw new Error("R04_PROGRAM_BOOK_PROVENANCE_INCOMPLETE");
    }
    const key = JSON.stringify([row.accountScope, row.sourceProgramId]);
    if (seenPrograms.has(key)) throw new Error("R04_DUPLICATE_PROGRAM_SOURCE_ID");
    seenPrograms.add(key);
    if (!row.ownerFound) missingOwnerRows += 1;
    if (row.bookId === null) rowsWithoutBookId += 1;
    else {
      const bookKey = JSON.stringify([row.accountScope, row.bookId]);
      const group = groups.get(bookKey) ?? { rows: 0, clients: new Set<string>() };
      group.rows += 1;
      group.clients.add(row.clientId);
      groups.set(bookKey, group);
    }
    if (row.libraryIdHint === "same-client") libraryIdSameClientHints += 1;
    else if (row.libraryIdHint === "other-client") libraryIdOtherClientHints += 1;
    else if (row.libraryIdHint === "not-found") libraryIdNotFoundHints += 1;
    else if (row.libraryIdHint === "library-not-observed") libraryNotObservedRows += 1;
    if (row.deletedMarker === "yes") deletedMarkerRows += 1;
    if (row.templateMarker === "yes") templateMarkerRows += 1;
    if (row.templateMarker === "invalid") invalidTemplateMarkerRows += 1;
  }
  let crossClientBookGroups = 0;
  let rowsInCrossClientBooks = 0;
  let singleClientMultiRowBookGroups = 0;
  for (const group of groups.values()) {
    if (group.clients.size > 1) {
      crossClientBookGroups += 1;
      rowsInCrossClientBooks += group.rows;
    } else if (group.rows > 1) singleClientMultiRowBookGroups += 1;
  }
  const groupedRows = [...groups.values()].reduce((sum, group) => sum + group.rows, 0);
  if (groupedRows + rowsWithoutBookId !== rows.length) {
    throw new Error("R04_PROGRAM_BOOK_CARDINALITY_MISMATCH");
  }
  return {
    status: "requires-semantic-review", physicalProgramRows: rows.length,
    missingOwnerRows, rowsWithoutBookId, distinctBookGroups: groups.size,
    crossClientBookGroups, rowsInCrossClientBooks, singleClientMultiRowBookGroups,
    libraryIdSameClientHints, libraryIdOtherClientHints,
    libraryIdNotFoundHints, libraryNotObservedRows,
    deletedMarkerRows, templateMarkerRows, invalidTemplateMarkerRows,
    targetMappedPrograms: 0, targetWrites: 0,
  };
}
