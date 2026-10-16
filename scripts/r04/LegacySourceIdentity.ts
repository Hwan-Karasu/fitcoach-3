import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { quoteLegacyIdentifier } from "./LegacyRowInventory.ts";

export interface LegacySourceIdentitySummary {
  readonly explicitKeyTables: number;
  readonly compositeKeyTables: number;
  readonly unkeyedTables: number;
  /** Physical rows lacking a complete explicit primary key; no rowid fallback. */
  readonly rowsWithoutCompleteKey: number;
  readonly keyCandidateRows: number;
  readonly enumeratedKeyRows: number;
  readonly sourceScopeBound: boolean;
  /** Hash of exact typed PK tuples, not an approved cross-database identity. */
  readonly sourceKeyLedgerDigest: string;
}

function encodeKeyPart(value: unknown): readonly [string, string] {
  if (typeof value === "string") return ["text", value];
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error("R04_SOURCE_IDENTITY_VALUE_UNSUPPORTED");
    }
    return ["number", Object.is(value, -0) ? "-0" : String(value)];
  }
  if (value instanceof Uint8Array) return ["blob", Buffer.from(value).toString("base64")];
  throw new Error("R04_SOURCE_IDENTITY_VALUE_UNSUPPORTED");
}

function safeCount(db: DatabaseSync, sql: string): number {
  const count = db.prepare(sql).get()?.total;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("R04_SOURCE_IDENTITY_COUNT_INVALID");
  }
  return count;
}

/** Tests source-row provenance candidates, not target identity or semantic equivalence. */
export function summarizeLegacySourceIdentity(
  db: DatabaseSync, tableNames: readonly string[], totalPhysicalRows: number,
  accountScope?: string,
): LegacySourceIdentitySummary {
  if (!Number.isSafeInteger(totalPhysicalRows) || totalPhysicalRows < 0) {
    throw new Error("R04_SOURCE_IDENTITY_COUNT_INVALID");
  }
  if (new Set(tableNames).size !== tableNames.length) {
    throw new Error("R04_SOURCE_IDENTITY_DUPLICATE_TABLE");
  }
  if (accountScope !== undefined && !accountScope.trim()) {
    throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  }
  let explicitKeyTables = 0;
  let compositeKeyTables = 0;
  let unkeyedTables = 0;
  let rowsWithoutCompleteKey = 0;
  let enumeratedKeyRows = 0;
  const sourceKeyLedger = createHash("sha256");
  sourceKeyLedger.update(JSON.stringify(accountScope === undefined
    ? ["unbound-source"] : ["account-scope", accountScope]));
  sourceKeyLedger.update("\n");
  for (const table of [...tableNames].sort()) {
    const keyColumns = db.prepare("SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk")
      .all(table).map((row) => String(row.name));
    const sourceTable = quoteLegacyIdentifier(table);
    if (keyColumns.length === 0) {
      unkeyedTables += 1;
      rowsWithoutCompleteKey += safeCount(db, `SELECT count(*) AS total FROM ${sourceTable}`);
    } else {
      explicitKeyTables += 1;
      if (keyColumns.length > 1) compositeKeyTables += 1;
      const incomplete = keyColumns.map((name) => `${quoteLegacyIdentifier(name)} IS NULL`).join(" OR ");
      rowsWithoutCompleteKey += safeCount(db,
        `SELECT count(*) AS total FROM ${sourceTable} WHERE ${incomplete}`);
      const selection = keyColumns.map(quoteLegacyIdentifier).join(", ");
      const keyQuery = db.prepare(`SELECT ${selection} FROM ${sourceTable} ORDER BY ${selection}`);
      keyQuery.setReadBigInts(true);
      for (const row of keyQuery.iterate()) {
        const values = keyColumns.map((name) => row[name]);
        if (values.some((value) => value === null)) continue;
        sourceKeyLedger.update(JSON.stringify([table, values.map(encodeKeyPart)]));
        sourceKeyLedger.update("\n");
        enumeratedKeyRows += 1;
        if (!Number.isSafeInteger(enumeratedKeyRows)) throw new Error("R04_SOURCE_IDENTITY_COUNT_INVALID");
      }
    }
    if (!Number.isSafeInteger(rowsWithoutCompleteKey) || rowsWithoutCompleteKey > totalPhysicalRows) {
      throw new Error("R04_SOURCE_IDENTITY_COUNT_INVALID");
    }
  }
  if (enumeratedKeyRows !== totalPhysicalRows - rowsWithoutCompleteKey) {
    throw new Error("R04_SOURCE_IDENTITY_COUNT_INVALID");
  }
  return {
    explicitKeyTables,
    compositeKeyTables,
    unkeyedTables,
    rowsWithoutCompleteKey,
    keyCandidateRows: totalPhysicalRows - rowsWithoutCompleteKey,
    enumeratedKeyRows,
    sourceScopeBound: accountScope !== undefined,
    sourceKeyLedgerDigest: sourceKeyLedger.digest("hex"),
  };
}
