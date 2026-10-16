import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface LegacyRowInventorySummary {
  readonly countedTables: number;
  readonly nonemptyTables: number;
  /** Physical SQLite rows across tables, not verified domain facts. */
  readonly totalPhysicalRows: number;
  /** Stable evidence of per-table counts without publishing those counts or names. */
  readonly rowCountLedgerDigest: string;
}

export function quoteLegacyIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Caller owns a read snapshot. Every observed table is counted, including unregistered ones. */
export function summarizeLegacyRowInventory(
  db: DatabaseSync, tableNames: readonly string[],
): LegacyRowInventorySummary {
  const uniqueNames = new Set(tableNames);
  if (uniqueNames.size !== tableNames.length) throw new Error("R04_ROW_INVENTORY_DUPLICATE_TABLE");
  const digest = createHash("sha256");
  let nonemptyTables = 0;
  let totalPhysicalRows = 0;
  for (const name of [...tableNames].sort()) {
    const row = db.prepare(`SELECT count(*) AS total FROM ${quoteLegacyIdentifier(name)}`).get();
    const count = row?.total;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("R04_ROW_INVENTORY_COUNT_INVALID");
    }
    if (count > 0) nonemptyTables += 1;
    totalPhysicalRows += count;
    if (!Number.isSafeInteger(totalPhysicalRows)) throw new Error("R04_ROW_INVENTORY_COUNT_INVALID");
    digest.update(JSON.stringify([name, count]));
    digest.update("\n");
  }
  return {
    countedTables: tableNames.length,
    nonemptyTables,
    totalPhysicalRows,
    rowCountLedgerDigest: digest.digest("hex"),
  };
}
