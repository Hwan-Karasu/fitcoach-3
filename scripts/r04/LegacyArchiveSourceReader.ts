import type { DatabaseSync } from "node:sqlite";

export interface LegacyArchiveSource {
  readonly accountScope: string;
  readonly sourceRowId: string;
  readonly clientId: string;
  readonly lifecycleShapeComplete: boolean;
  readonly deletedAtRaw: string | null;
  readonly jsonStatus: "object" | "invalid-json";
  readonly programReferenceStatus: "missing-id" | "same-client" | "other-client" | "not-found";
  /** Same nonempty legacy book_id exists for archive owner; never proves fact ownership. */
  readonly otherClientSharedBookCandidate: boolean;
  readonly workoutsStatus: "array" | "missing-array";
  readonly workoutCount: number;
  readonly weeksStatus: "array" | "missing-array";
  readonly declaredWorkoutCountStatus: "matches" | "mismatch" | "not-declared";
}

type RawArchiveRow = Readonly<{
  sourceRowId: unknown;
  clientId: unknown;
  ownerClientId: unknown;
  dataJson: unknown;
  deletedAtRaw: unknown;
}>;

function textOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("R04_ARCHIVE_VALUE_UNSUPPORTED");
  return value;
}

/** Archive snapshots are a separate legacy source, not duplicate performed sessions. */
export function readLegacyArchiveRowsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyArchiveSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const required: Readonly<Record<string, readonly string[]>> = {
    training_archive_entries: ["id", "client_id", "data_json", "archived_at"],
    training_programs: ["id", "client_id", "book_id"],
    clients: ["id"],
  };
  let lifecycleShapeComplete = false;
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    if (columns.some((column) => !actual.has(column))) throw new Error("R04_ARCHIVE_SHAPE_UNSUPPORTED");
    if (table === "training_archive_entries") lifecycleShapeComplete = actual.has("deleted_at");
  }
  const programs = new Map<string, { clientId: string; bookId: string | null }>();
  const booksByClient = new Map<string, Set<string>>();
  for (const row of db.prepare("SELECT id, client_id, book_id FROM training_programs").all()) {
    const id = textOrNull(row.id);
    const clientId = textOrNull(row.client_id);
    const bookId = textOrNull(row.book_id);
    if (!id?.trim() || !clientId?.trim()) throw new Error("R04_ARCHIVE_PROGRAM_PROVENANCE_INCOMPLETE");
    programs.set(id, { clientId, bookId });
    if (bookId?.trim()) {
      const books = booksByClient.get(clientId) ?? new Set<string>();
      books.add(bookId);
      booksByClient.set(clientId, books);
    }
  }
  const deletionColumn = lifecycleShapeComplete ? "a.deleted_at" : "NULL";
  const rows = db.prepare(`SELECT a.id AS sourceRowId, a.client_id AS clientId,
      c.id AS ownerClientId, a.data_json AS dataJson,
      ${deletionColumn} AS deletedAtRaw
    FROM training_archive_entries a
    LEFT JOIN clients c ON c.id=a.client_id
    ORDER BY a.id`).all() as unknown as RawArchiveRow[];
  const physicalCount = db.prepare("SELECT count(*) AS count FROM training_archive_entries").get() as { count: number };
  if (rows.length !== physicalCount.count) throw new Error("R04_ARCHIVE_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyArchiveSource => {
    const sourceRowId = textOrNull(row.sourceRowId);
    const clientId = textOrNull(row.clientId);
    const ownerClientId = textOrNull(row.ownerClientId);
    if (!sourceRowId?.trim() || !clientId?.trim() || ownerClientId !== clientId) {
      throw new Error("R04_ARCHIVE_PROVENANCE_INCOMPLETE");
    }
    let data: unknown;
    try { data = typeof row.dataJson === "string" ? JSON.parse(row.dataJson) as unknown : null; }
    catch { data = null; }
    const validObject = typeof data === "object" && data !== null && !Array.isArray(data);
    const record = validObject ? data as Record<string, unknown> : {};
    const programId = typeof record.programId === "string" && record.programId.trim()
      ? record.programId : null;
    const program = programId === null ? undefined : programs.get(programId);
    const programReferenceStatus = programId === null ? "missing-id"
      : program === undefined ? "not-found"
        : program.clientId === clientId ? "same-client" : "other-client";
    const otherClientSharedBookCandidate = programReferenceStatus === "other-client"
      && !!program?.bookId?.trim() && !!booksByClient.get(clientId)?.has(program.bookId);
    const workouts = Array.isArray(record.workouts) ? record.workouts : null;
    const declared = record.totalWorkouts;
    const declaredWorkoutCountStatus = typeof declared === "number" && Number.isSafeInteger(declared)
      && declared >= 0 ? declared === workouts?.length ? "matches" : "mismatch" : "not-declared";
    return {
      accountScope, sourceRowId, clientId, lifecycleShapeComplete,
      deletedAtRaw: textOrNull(row.deletedAtRaw),
      jsonStatus: validObject ? "object" : "invalid-json",
      programReferenceStatus, otherClientSharedBookCandidate,
      workoutsStatus: workouts === null ? "missing-array" : "array",
      workoutCount: workouts?.length ?? 0,
      weeksStatus: Array.isArray(record.weeks) ? "array" : "missing-array",
      declaredWorkoutCountStatus,
    };
  });
}
