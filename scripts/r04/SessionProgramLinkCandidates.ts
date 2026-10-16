import type { DatabaseSync } from "node:sqlite";
import type { LegacyProgramBookSource } from "./LegacyProgramBookSourceReader.ts";

export type SessionProgramLinkKind = "direct-same-client" | "direct-other-client" |
  "book-same-client-hint" | "book-other-client-hint" | "unresolved";
export type SessionProgramLinkReason = "SOURCE_LINK_UNVERIFIED" |
  "CROSS_CLIENT_PROGRAM_ID" | "BOOK_ID_ONLY_HINT" |
  "CROSS_CLIENT_BOOK_ID_HINT" | "PROGRAM_KEY_UNRESOLVED" |
  "PROGRAM_KEY_MISSING" | "DELETED_PLAN_MARKER_PRESENT" |
  "PROGRAM_OWNER_MISSING";

export interface SessionProgramLinkCandidate {
  readonly sourceKey: string;
  readonly accountScope: string;
  readonly sourceSessionId: string;
  readonly clientId: string;
  readonly programKeyRaw: string | null;
  readonly sourceWorkoutId: string | null;
  readonly sourceWorkoutColumnObserved: boolean;
  readonly matchedSourceProgramId: string | null;
  readonly linkKind: SessionProgramLinkKind;
  readonly reasons: readonly SessionProgramLinkReason[];
  readonly disposition: "BLOCKED_PENDING_SEMANTIC_REVIEW";
  readonly targetProgramId: null;
  readonly targetWrites: 0;
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Per-session quarantine ledger; its source keys and values never enter the public report. */
export function readSessionProgramLinkCandidatesInSnapshot(
  db: DatabaseSync, accountScope: string,
  programs: readonly LegacyProgramBookSource[],
): readonly SessionProgramLinkCandidate[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const columns = new Set(db.prepare("PRAGMA table_info('training_sessions')").all()
    .map((row) => String(row.name)));
  if (["id", "client_id", "program_key"].some((column) => !columns.has(column))) {
    throw new Error("R04_SESSION_PROGRAM_SHAPE_UNSUPPORTED");
  }
  const byId = new Map<string, LegacyProgramBookSource>();
  const bookClients = new Map<string, Set<string>>();
  for (const program of programs) {
    if (program.accountScope !== accountScope) throw new Error("R04_SESSION_PROGRAM_SCOPE_MISMATCH");
    if (byId.has(program.sourceProgramId)) throw new Error("R04_DUPLICATE_PROGRAM_SOURCE_ID");
    byId.set(program.sourceProgramId, program);
    if (program.bookId !== null) {
      const clients = bookClients.get(program.bookId) ?? new Set<string>();
      clients.add(program.clientId);
      bookClients.set(program.bookId, clients);
    }
  }
  const sourceWorkoutColumnObserved = columns.has("source_workout_id");
  const sourceWorkoutSelect = sourceWorkoutColumnObserved
    ? "source_workout_id" : "NULL AS source_workout_id";
  const rows = db.prepare(`SELECT id, client_id, program_key, ${sourceWorkoutSelect}
    FROM training_sessions ORDER BY id`).all();
  const count = db.prepare("SELECT count(*) AS count FROM training_sessions").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_SESSION_PROGRAM_CARDINALITY_MISMATCH");
  const seen = new Set<string>();
  return rows.map((row): SessionProgramLinkCandidate => {
    const sourceSessionId = requiredText(row.id);
    const clientId = requiredText(row.client_id);
    if (sourceSessionId === null || clientId === null) {
      throw new Error("R04_SESSION_PROGRAM_PROVENANCE_INCOMPLETE");
    }
    const sourceKey = JSON.stringify([accountScope, "training_sessions", sourceSessionId]);
    if (seen.has(sourceKey)) throw new Error("R04_DUPLICATE_PROGRAM_SESSION_ID");
    seen.add(sourceKey);
    if (row.program_key !== null && typeof row.program_key !== "string") {
      throw new Error("R04_SESSION_PROGRAM_KEY_UNSUPPORTED");
    }
    if (row.source_workout_id !== null && typeof row.source_workout_id !== "string") {
      throw new Error("R04_SESSION_SOURCE_WORKOUT_ID_UNSUPPORTED");
    }
    const programKeyRaw = requiredText(row.program_key);
    const direct = programKeyRaw === null ? undefined : byId.get(programKeyRaw);
    let linkKind: SessionProgramLinkKind;
    const reasons: SessionProgramLinkReason[] = ["SOURCE_LINK_UNVERIFIED"];
    if (direct !== undefined) {
      linkKind = direct.clientId === clientId ? "direct-same-client" : "direct-other-client";
      if (linkKind === "direct-other-client") reasons.push("CROSS_CLIENT_PROGRAM_ID");
      if (!direct.ownerFound) reasons.push("PROGRAM_OWNER_MISSING");
      if (direct.deletedMarker === "yes") reasons.push("DELETED_PLAN_MARKER_PRESENT");
    } else if (programKeyRaw === null) {
      linkKind = "unresolved";
      reasons.push("PROGRAM_KEY_MISSING");
    } else {
      const clients = bookClients.get(programKeyRaw);
      if (clients?.has(clientId)) {
        linkKind = "book-same-client-hint";
        reasons.push("BOOK_ID_ONLY_HINT");
      } else if (clients !== undefined) {
        linkKind = "book-other-client-hint";
        reasons.push("CROSS_CLIENT_BOOK_ID_HINT");
      } else {
        linkKind = "unresolved";
        reasons.push("PROGRAM_KEY_UNRESOLVED");
      }
    }
    return {
      sourceKey, accountScope, sourceSessionId, clientId, programKeyRaw,
      sourceWorkoutId: requiredText(row.source_workout_id), sourceWorkoutColumnObserved,
      matchedSourceProgramId: direct?.sourceProgramId ?? null,
      linkKind, reasons, disposition: "BLOCKED_PENDING_SEMANTIC_REVIEW",
      targetProgramId: null, targetWrites: 0,
    };
  });
}

export interface SessionProgramLinkCandidateSummary {
  readonly status: "requires-semantic-review";
  readonly physicalSessions: number;
  readonly directSameClient: number;
  readonly directOtherClient: number;
  readonly bookSameClientHints: number;
  readonly bookOtherClientHints: number;
  readonly unresolvedKeys: number;
  readonly deletedPlanMarkerSessions: number;
  readonly targetMappedSessions: 0;
  readonly targetWrites: 0;
}

/** Aggregate-only output; all source identities stay in the internal ledger. */
export function summarizeSessionProgramLinkCandidates(
  candidates: readonly SessionProgramLinkCandidate[],
): SessionProgramLinkCandidateSummary {
  const seen = new Set<string>();
  const counts: Record<SessionProgramLinkKind, number> = {
    "direct-same-client": 0, "direct-other-client": 0,
    "book-same-client-hint": 0, "book-other-client-hint": 0, unresolved: 0,
  };
  let deletedPlanMarkerSessions = 0;
  for (const candidate of candidates) {
    const expectedKey = JSON.stringify([candidate.accountScope, "training_sessions",
      candidate.sourceSessionId]);
    if (candidate.sourceKey !== expectedKey) throw new Error("R04_SESSION_PROGRAM_KEY_MISMATCH");
    if (seen.has(expectedKey)) throw new Error("R04_DUPLICATE_PROGRAM_SESSION_ID");
    seen.add(expectedKey);
    counts[candidate.linkKind] += 1;
    if (candidate.linkKind === "direct-same-client"
      && candidate.reasons.includes("DELETED_PLAN_MARKER_PRESENT")) deletedPlanMarkerSessions += 1;
  }
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== candidates.length) {
    throw new Error("R04_SESSION_PROGRAM_CLASSIFICATION_INCOMPLETE");
  }
  return {
    status: "requires-semantic-review", physicalSessions: candidates.length,
    directSameClient: counts["direct-same-client"],
    directOtherClient: counts["direct-other-client"],
    bookSameClientHints: counts["book-same-client-hint"],
    bookOtherClientHints: counts["book-other-client-hint"],
    unresolvedKeys: counts.unresolved,
    deletedPlanMarkerSessions,
    targetMappedSessions: 0, targetWrites: 0,
  };
}
