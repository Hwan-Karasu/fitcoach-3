import type { DatabaseSync } from "node:sqlite";

export interface LegacyClientReferenceInventory {
  readonly status: "requires-semantic-review";
  readonly clientIdColumnTables: number;
  /** Physical rows across different source tables, not unique domain facts. */
  readonly physicalRowsInTheseTables: number;
  readonly linkedToKnownClientRows: number;
  readonly missingClientKeyRows: number;
  readonly orphanClientKeyRows: number;
  readonly linkedToArchivedClientRows: number;
  readonly linkedToDeletedClientRows: number;
  readonly lifecycleColumnsPresent: boolean;
  readonly tablesWithMissingOrOrphanKeys: number;
  readonly targetMappedReferences: 0;
  readonly targetWrites: 0;
}

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function safeCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("R04_CLIENT_REFERENCE_COUNT_UNSAFE");
  return count;
}

function addSafe(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("R04_CLIENT_REFERENCE_COUNT_UNSAFE");
  return result;
}

/** Scans direct client_id columns in the same read snapshot as source coverage. */
export function inventoryLegacyClientReferencesInSnapshot(
  db: DatabaseSync, accountScope: string,
): LegacyClientReferenceInventory {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const clientColumns = new Set(db.prepare("PRAGMA table_xinfo('clients')").all()
    .map((row) => String(row.name)));
  if (!clientColumns.has("id")) throw new Error("R04_CLIENT_REFERENCE_CLIENT_SHAPE_UNSUPPORTED");
  const lifecycleColumnsPresent = clientColumns.has("archived_at")
    && clientColumns.has("deleted_at");
  const tables = db.prepare(`SELECT name FROM sqlite_schema
    WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name`).all();
  let clientIdColumnTables = 0;
  let physicalRowsInTheseTables = 0;
  let linkedToKnownClientRows = 0;
  let missingClientKeyRows = 0;
  let orphanClientKeyRows = 0;
  let linkedToArchivedClientRows = 0;
  let linkedToDeletedClientRows = 0;
  let tablesWithMissingOrOrphanKeys = 0;
  for (const table of tables) {
    if (typeof table.name !== "string") throw new Error("R04_CLIENT_REFERENCE_TABLE_NAME_INVALID");
    const columns = db.prepare("SELECT name FROM pragma_table_xinfo(?)").all(table.name);
    if (!columns.some((column) => column.name === "client_id")) continue;
    clientIdColumnTables += 1;
    const tableName = quoted(table.name);
    const sourceCount = safeCount((db.prepare(`SELECT count(*) AS count FROM ${tableName}`)
      .get() as { count: unknown }).count);
    const missing = "t.client_id IS NULL OR length(trim(CAST(t.client_id AS TEXT)))=0";
    const known = `NOT (${missing}) AND c.id IS NOT NULL`;
    const result = db.prepare(`SELECT
      count(*) AS joinedRows,
      sum(CASE WHEN ${missing} THEN 1 ELSE 0 END) AS missingRows,
      sum(CASE WHEN NOT (${missing}) AND c.id IS NULL THEN 1 ELSE 0 END) AS orphanRows,
      sum(CASE WHEN ${known} THEN 1 ELSE 0 END) AS knownRows,
      ${lifecycleColumnsPresent
        ? `sum(CASE WHEN ${known} AND c.archived_at IS NOT NULL THEN 1 ELSE 0 END)`
        : "0"} AS archivedRows,
      ${lifecycleColumnsPresent
        ? `sum(CASE WHEN ${known} AND c.deleted_at IS NOT NULL THEN 1 ELSE 0 END)`
        : "0"} AS deletedRows
      FROM ${tableName} t LEFT JOIN clients c ON c.id=t.client_id`).get() as
      Record<string, unknown> | undefined;
    if (result === undefined) throw new Error("R04_CLIENT_REFERENCE_COUNT_MISSING");
    const joinedRows = safeCount(result.joinedRows);
    const missingRows = safeCount(result.missingRows ?? 0);
    const orphanRows = safeCount(result.orphanRows ?? 0);
    const knownRows = safeCount(result.knownRows ?? 0);
    const archivedRows = safeCount(result.archivedRows);
    const deletedRows = safeCount(result.deletedRows);
    if (joinedRows !== sourceCount || missingRows + orphanRows + knownRows !== sourceCount
      || archivedRows > knownRows || deletedRows > knownRows) {
      throw new Error("R04_CLIENT_REFERENCE_CARDINALITY_MISMATCH");
    }
    physicalRowsInTheseTables = addSafe(physicalRowsInTheseTables, sourceCount);
    linkedToKnownClientRows = addSafe(linkedToKnownClientRows, knownRows);
    missingClientKeyRows = addSafe(missingClientKeyRows, missingRows);
    orphanClientKeyRows = addSafe(orphanClientKeyRows, orphanRows);
    linkedToArchivedClientRows = addSafe(linkedToArchivedClientRows, archivedRows);
    linkedToDeletedClientRows = addSafe(linkedToDeletedClientRows, deletedRows);
    if (missingRows > 0 || orphanRows > 0) tablesWithMissingOrOrphanKeys += 1;
  }
  return {
    status: "requires-semantic-review", clientIdColumnTables,
    physicalRowsInTheseTables, linkedToKnownClientRows,
    missingClientKeyRows, orphanClientKeyRows,
    linkedToArchivedClientRows, linkedToDeletedClientRows,
    lifecycleColumnsPresent, tablesWithMissingOrOrphanKeys,
    targetMappedReferences: 0, targetWrites: 0,
  };
}
