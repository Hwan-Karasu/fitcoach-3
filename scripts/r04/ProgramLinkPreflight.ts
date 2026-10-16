import type { DatabaseSync } from "node:sqlite";
import type { LegacySetSource } from "./SourceFactPreflight.ts";
import type { LegacyProgramBookSource } from "./LegacyProgramBookSourceReader.ts";

export interface ProgramLinkPreflightReport {
  readonly status: "requires-semantic-review";
  readonly physicalSessionRows: number;
  readonly sessionDirectSameClientRows: number;
  readonly sessionDirectOtherClientRows: number;
  readonly sessionBookSameClientHints: number;
  readonly sessionBookOtherClientHints: number;
  readonly sessionUnresolvedKeys: number;
  readonly physicalPlannedWorkoutRows: number;
  readonly workoutDirectSameClientRows: number;
  readonly workoutDirectOtherClientRows: number;
  readonly workoutBookSameClientHints: number;
  readonly workoutBookOtherClientHints: number;
  readonly workoutUnresolvedKeys: number;
  readonly deletedProgramsWithDirectSessionRows: number;
  readonly deletedProgramsWithDirectWorkoutRows: number;
  readonly physicalSetRowsViaDeletedProgramSessions: number;
  readonly targetMappedLinks: 0;
  readonly targetWrites: 0;
}

type LinkKind = "direct-same" | "direct-other" | "book-same" | "book-other" | "unresolved";

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredColumns(db: DatabaseSync, table: string, columns: readonly string[]): void {
  const actual = new Set(db.prepare("SELECT name FROM pragma_table_xinfo(?)").all(table)
    .map((row) => String(row.name)));
  if (columns.some((column) => !actual.has(column))) throw new Error("R04_PROGRAM_LINK_SHAPE_UNSUPPORTED");
}

/** Joins direct source keys only; book matches remain hints, never canonical fact links. */
export function preflightProgramLinksInSnapshot(
  db: DatabaseSync, accountScope: string,
  programs: readonly LegacyProgramBookSource[], sets: readonly LegacySetSource[],
): ProgramLinkPreflightReport {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  requiredColumns(db, "training_sessions", ["id", "client_id", "program_key"]);
  requiredColumns(db, "training_workouts", ["id", "client_id", "program_id"]);
  const byId = new Map<string, LegacyProgramBookSource>();
  const books = new Map<string, Set<string>>();
  for (const program of programs) {
    if (program.accountScope !== accountScope) throw new Error("R04_PROGRAM_LINK_SCOPE_MISMATCH");
    if (byId.has(program.sourceProgramId)) throw new Error("R04_DUPLICATE_PROGRAM_SOURCE_ID");
    byId.set(program.sourceProgramId, program);
    if (program.bookId !== null) {
      const clients = books.get(program.bookId) ?? new Set<string>();
      clients.add(program.clientId);
      books.set(program.bookId, clients);
    }
  }
  const classify = (clientId: string, key: string | null):
    { kind: LinkKind; program: LegacyProgramBookSource | null } => {
    if (key === null) return { kind: "unresolved", program: null };
    const direct = byId.get(key);
    if (direct) return { kind: direct.clientId === clientId ? "direct-same" : "direct-other",
      program: direct };
    const bookClients = books.get(key);
    if (bookClients?.has(clientId)) return { kind: "book-same", program: null };
    if (bookClients !== undefined) return { kind: "book-other", program: null };
    return { kind: "unresolved", program: null };
  };
  const setRowsBySession = new Map<string, number>();
  for (const set of sets) {
    if (set.accountScope !== accountScope) throw new Error("R04_PROGRAM_LINK_SCOPE_MISMATCH");
    setRowsBySession.set(set.sessionId, (setRowsBySession.get(set.sessionId) ?? 0) + 1);
  }
  const sessions = db.prepare("SELECT id, client_id, program_key FROM training_sessions ORDER BY id").all();
  const sessionCount = db.prepare("SELECT count(*) AS count FROM training_sessions").get() as { count: number };
  if (sessions.length !== sessionCount.count) throw new Error("R04_PROGRAM_SESSION_CARDINALITY_MISMATCH");
  const seenSessions = new Set<string>();
  const directDeletedSessionPrograms = new Set<string>();
  const sessionCounts: Record<LinkKind, number> = {
    "direct-same": 0, "direct-other": 0, "book-same": 0, "book-other": 0, unresolved: 0,
  };
  let physicalSetRowsViaDeletedProgramSessions = 0;
  for (const row of sessions) {
    const id = textOrNull(row.id);
    const clientId = textOrNull(row.client_id);
    if (id === null || clientId === null) throw new Error("R04_PROGRAM_SESSION_PROVENANCE_INCOMPLETE");
    if (seenSessions.has(id)) throw new Error("R04_DUPLICATE_PROGRAM_SESSION_ID");
    seenSessions.add(id);
    const link = classify(clientId, textOrNull(row.program_key));
    sessionCounts[link.kind] += 1;
    if (link.kind === "direct-same" && link.program?.deletedMarker === "yes") {
      directDeletedSessionPrograms.add(link.program.sourceProgramId);
      physicalSetRowsViaDeletedProgramSessions += setRowsBySession.get(id) ?? 0;
    }
  }
  for (const sessionId of setRowsBySession.keys()) {
    if (!seenSessions.has(sessionId)) throw new Error("R04_PROGRAM_SET_SESSION_MISSING");
  }
  const workouts = db.prepare("SELECT id, client_id, program_id FROM training_workouts ORDER BY id").all();
  const workoutCount = db.prepare("SELECT count(*) AS count FROM training_workouts").get() as { count: number };
  if (workouts.length !== workoutCount.count) throw new Error("R04_PROGRAM_WORKOUT_CARDINALITY_MISMATCH");
  const seenWorkouts = new Set<string>();
  const directDeletedWorkoutPrograms = new Set<string>();
  const workoutCounts: Record<LinkKind, number> = {
    "direct-same": 0, "direct-other": 0, "book-same": 0, "book-other": 0, unresolved: 0,
  };
  for (const row of workouts) {
    const id = textOrNull(row.id);
    const clientId = textOrNull(row.client_id);
    if (id === null || clientId === null) throw new Error("R04_PROGRAM_WORKOUT_PROVENANCE_INCOMPLETE");
    if (seenWorkouts.has(id)) throw new Error("R04_DUPLICATE_PROGRAM_WORKOUT_ID");
    seenWorkouts.add(id);
    const link = classify(clientId, textOrNull(row.program_id));
    workoutCounts[link.kind] += 1;
    if (link.kind === "direct-same" && link.program?.deletedMarker === "yes") {
      directDeletedWorkoutPrograms.add(link.program.sourceProgramId);
    }
  }
  if (Object.values(sessionCounts).reduce((sum, count) => sum + count, 0) !== sessions.length
    || Object.values(workoutCounts).reduce((sum, count) => sum + count, 0) !== workouts.length) {
    throw new Error("R04_PROGRAM_LINK_CLASSIFICATION_INCOMPLETE");
  }
  return {
    status: "requires-semantic-review", physicalSessionRows: sessions.length,
    sessionDirectSameClientRows: sessionCounts["direct-same"],
    sessionDirectOtherClientRows: sessionCounts["direct-other"],
    sessionBookSameClientHints: sessionCounts["book-same"],
    sessionBookOtherClientHints: sessionCounts["book-other"],
    sessionUnresolvedKeys: sessionCounts.unresolved,
    physicalPlannedWorkoutRows: workouts.length,
    workoutDirectSameClientRows: workoutCounts["direct-same"],
    workoutDirectOtherClientRows: workoutCounts["direct-other"],
    workoutBookSameClientHints: workoutCounts["book-same"],
    workoutBookOtherClientHints: workoutCounts["book-other"],
    workoutUnresolvedKeys: workoutCounts.unresolved,
    deletedProgramsWithDirectSessionRows: directDeletedSessionPrograms.size,
    deletedProgramsWithDirectWorkoutRows: directDeletedWorkoutPrograms.size,
    physicalSetRowsViaDeletedProgramSessions,
    targetMappedLinks: 0, targetWrites: 0,
  };
}
