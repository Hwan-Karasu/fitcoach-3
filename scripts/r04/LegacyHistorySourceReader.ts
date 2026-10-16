import type { DatabaseSync } from "node:sqlite";
import type { LegacyHistorySource } from "./HistoryLinkPreflight.ts";

const requiredShape: Readonly<Record<string, readonly string[]>> = {
  training_exercise_history: ["id", "client_id", "source_fact_id"],
  clients: ["id"],
};

interface RawHistoryRow {
  readonly sourceRowId: unknown;
  readonly clientId: unknown;
  readonly ownerClientId: unknown;
  readonly sourceFactId: unknown;
  readonly deletedAtRaw: unknown;
}

function textOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("R04_HISTORY_VALUE_UNSUPPORTED");
  return value;
}

/** Separate read-only source screen; no history row is turned into a set. */
export function readLegacyHistoryRows(db: DatabaseSync, accountScope: string): readonly LegacyHistorySource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  db.exec("PRAGMA query_only = ON");
  db.exec("BEGIN");
  try { return readLegacyHistoryRowsInSnapshot(db, accountScope); }
  finally { db.exec("ROLLBACK"); }
}

/** Caller must hold a read transaction; never synthesizes missing set rows. */
export function readLegacyHistoryRowsInSnapshot(db: DatabaseSync, accountScope: string): readonly LegacyHistorySource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  let lifecycleShapeComplete = false;
  for (const [table, columns] of Object.entries(requiredShape)) {
    const actual = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
    if (columns.some((column) => !actual.has(column))) throw new Error("R04_HISTORY_SHAPE_UNSUPPORTED");
    if (table === "training_exercise_history") lifecycleShapeComplete = actual.has("deleted_at");
  }
  const deletionColumn = lifecycleShapeComplete ? "h.deleted_at" : "NULL";
  const rows = db.prepare(`SELECT h.id AS sourceRowId, h.client_id AS clientId,
      c.id AS ownerClientId, h.source_fact_id AS sourceFactId,
      ${deletionColumn} AS deletedAtRaw
      FROM training_exercise_history h
      LEFT JOIN clients c ON c.id=h.client_id
      ORDER BY h.id`).all() as unknown as RawHistoryRow[];
  const physicalCount = db.prepare("SELECT count(*) AS count FROM training_exercise_history").get() as { count: number };
  if (rows.length !== physicalCount.count) throw new Error("R04_HISTORY_ROW_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyHistorySource => {
    const sourceRowId = textOrNull(row.sourceRowId);
    const clientId = textOrNull(row.clientId);
    const ownerClientId = textOrNull(row.ownerClientId);
    if (!sourceRowId || !clientId || ownerClientId !== clientId) {
      throw new Error("R04_HISTORY_PROVENANCE_INCOMPLETE");
    }
    return { accountScope, sourceRowId, clientId, sourceFactId: textOrNull(row.sourceFactId),
      deletedAtRaw: textOrNull(row.deletedAtRaw), lifecycleShapeComplete };
  });
}
