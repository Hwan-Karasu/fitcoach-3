import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import { checkWorkDataRow, WORK_DATA_COLUMNS, WORK_DATA_FORMAT, WORK_DATA_TABLES, workDataFail as fail, type WorkDataRows } from "./ClientWorkDataRows.ts";

const canonicalRow = (row: Readonly<Record<string, unknown>>) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
/** Only for a new admitted candidate, in the caller's shared transaction. It
 * never merges an import into edited live records, allocates IDs or creates DDL.
 * Replaying an identical seed is read-only; any existing difference fails closed. */
export async function installInitialClientWorkData(tx: SqliteStatementPort, workspaceId: string, input: WorkDataRows): Promise<void> {
  // Capture and validate synchronously before the first await.
  const captured = {} as Record<typeof WORK_DATA_TABLES[number], readonly Readonly<Record<string, string | number | null>>[]>;
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify([...WORK_DATA_TABLES].sort())) fail("SEED_INVALID");
  for (const table of WORK_DATA_TABLES) {
    captured[table] = input[table].map((row) => {
      checkWorkDataRow(table, row);
      if (row.workspace_id !== workspaceId || Object.values(row).some((v) => v !== null && typeof v !== "string" && typeof v !== "number")) return fail("SEED_INVALID");
      return { ...row } as Readonly<Record<string, string | number | null>>;
    });
  }
  const formats = await tx.all<{ id: number; format_version: number; tag_name_policy: string }>("SELECT * FROM client_work_data_format");
  if (formats.length !== 1 || formats[0]?.id !== 1 || formats[0].format_version !== WORK_DATA_FORMAT.version
    || formats[0].tag_name_policy !== WORK_DATA_FORMAT.tagNamePolicy
    || !await tx.first("SELECT 1 FROM workspaces WHERE id=?", [workspaceId])) fail("FORMAT_UNSUPPORTED");
  const expected = new Map(WORK_DATA_TABLES.map((table) => [table, captured[table].map(canonicalRow).sort()]));
  let present = false;
  for (const table of WORK_DATA_TABLES) {
    const rows = await tx.all(`SELECT * FROM ${table} WHERE workspace_id=?`, [workspaceId]); if (rows.length) present = true;
  }
  if (!present) for (const table of WORK_DATA_TABLES) {
    const columns = WORK_DATA_COLUMNS[table];
    for (const row of captured[table]) await tx.run(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, columns.map((c) => row[c]!));
  }
  for (const table of WORK_DATA_TABLES) {
    const actual = (await tx.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE workspace_id=?`, [workspaceId])).map(canonicalRow).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected.get(table))) fail("INITIAL_PARITY_MISMATCH");
  }
}
