import type { DatabaseSync } from "node:sqlite";

export interface LegacyProgramBookSource {
  readonly accountScope: string;
  readonly sourceProgramId: string;
  readonly clientId: string;
  readonly ownerFound: boolean;
  readonly bookId: string | null;
  readonly modeRaw: string | null;
  readonly cycleTypeRaw: string | null;
  readonly templateMarker: "yes" | "no" | "missing" | "invalid";
  readonly deletedMarker: "yes" | "no" | "missing";
  /** ID equality only; not proof that book_id is a library FK or a shared target aggregate. */
  readonly libraryIdHint: "same-client" | "other-client" | "not-found" |
    "no-book" | "library-not-observed";
  readonly targetProgramId: null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function templateMarker(value: unknown, observed: boolean): LegacyProgramBookSource["templateMarker"] {
  if (!observed) return "missing";
  if (value === 1 || value === "1") return "yes";
  if (value === 0 || value === "0") return "no";
  return "invalid";
}

/** Source rows remain individual client-owned programs even when book_id is shared. */
export function readLegacyProgramBooksInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyProgramBookSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const programColumns = new Set(db.prepare("PRAGMA table_info('training_programs')").all()
    .map((row) => String(row.name)));
  if (["id", "client_id", "book_id"].some((column) => !programColumns.has(column))) {
    throw new Error("R04_PROGRAM_BOOK_SHAPE_UNSUPPORTED");
  }
  const libraryColumns = new Set(db.prepare("PRAGMA table_info('training_library_programs')").all()
    .map((row) => String(row.name)));
  const libraryObserved = libraryColumns.has("id") && libraryColumns.has("client_id");
  const libraryOwners = new Map<string, Set<string>>();
  if (libraryObserved) {
    const libraryRows = db.prepare("SELECT id, client_id FROM training_library_programs").all();
    for (const row of libraryRows) {
      const id = textOrNull(row.id);
      const clientId = textOrNull(row.client_id);
      if (id === null || clientId === null) throw new Error("R04_PROGRAM_LIBRARY_PROVENANCE_INCOMPLETE");
      const owners = libraryOwners.get(id) ?? new Set<string>();
      if (owners.has(clientId)) throw new Error("R04_DUPLICATE_PROGRAM_LIBRARY_ID");
      owners.add(clientId);
      libraryOwners.set(id, owners);
    }
    const count = db.prepare("SELECT count(*) AS count FROM training_library_programs").get() as
      { count: number };
    if (libraryRows.length !== count.count) throw new Error("R04_PROGRAM_LIBRARY_CARDINALITY_MISMATCH");
  }
  const mode = programColumns.has("mode") ? "p.mode" : "NULL";
  const cycleType = programColumns.has("cycle_type") ? "p.cycle_type" : "NULL";
  const template = programColumns.has("is_template") ? "p.is_template" : "NULL";
  const deleted = programColumns.has("deleted_at") ? "p.deleted_at" : "NULL";
  const rows = db.prepare(`SELECT p.id AS sourceProgramId, p.client_id AS clientId,
    p.book_id AS bookId, ${mode} AS modeRaw, ${cycleType} AS cycleTypeRaw,
    ${template} AS templateRaw, ${deleted} AS deletedAtRaw,
    c.id AS ownerClientId FROM training_programs p
    LEFT JOIN clients c ON c.id=p.client_id ORDER BY p.id`).all();
  const count = db.prepare("SELECT count(*) AS count FROM training_programs").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_PROGRAM_BOOK_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyProgramBookSource => {
    const sourceProgramId = textOrNull(row.sourceProgramId);
    const clientId = textOrNull(row.clientId);
    if (sourceProgramId === null || clientId === null) {
      throw new Error("R04_PROGRAM_BOOK_PROVENANCE_INCOMPLETE");
    }
    const bookId = textOrNull(row.bookId);
    const libraryClients = bookId === null ? undefined : libraryOwners.get(bookId);
    const libraryIdHint = bookId === null ? "no-book"
      : !libraryObserved ? "library-not-observed"
        : libraryClients === undefined ? "not-found"
          : libraryClients.has(clientId) ? "same-client" : "other-client";
    return {
      accountScope, sourceProgramId, clientId,
      ownerFound: row.ownerClientId === clientId, bookId,
      modeRaw: textOrNull(row.modeRaw), cycleTypeRaw: textOrNull(row.cycleTypeRaw),
      templateMarker: templateMarker(row.templateRaw, programColumns.has("is_template")),
      deletedMarker: !programColumns.has("deleted_at") ? "missing"
        : textOrNull(row.deletedAtRaw) === null ? "no" : "yes",
      libraryIdHint, targetProgramId: null,
    };
  });
}
