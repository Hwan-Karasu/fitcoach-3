import type { SqlValue } from "../db/SqlitePort.ts";
import type { LegacySourceRow } from "./LegacyProfileSources.ts";

export interface LegacyReadQuery { readonly sql: string; readonly bindings: readonly SqlValue[] }
export type LegacySourceReadPlan<Result> = Generator<LegacyReadQuery, Result, readonly LegacySourceRow[]>;
const query = (sql: string, bindings: readonly SqlValue[] = []): LegacyReadQuery => ({ sql, bindings });
const fail = (code: string): never => { throw new Error(code); };
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

function* present(table: string, shapeError: string): LegacySourceReadPlan<boolean> {
  const rows = yield query("SELECT type FROM sqlite_schema WHERE lower(name)=?", [table]);
  if (rows.length && (rows.length !== 1 || rows[0]!.type !== "table")) return fail(shapeError);
  return rows.length === 1;
}

function* read(table: string, required: readonly string[], shapeError: string, coverageError: string, key?: string, order: readonly string[] = []): LegacySourceReadPlan<readonly LegacySourceRow[] | null> {
  if (!(yield* present(table, shapeError))) return null;
  // table_info omits generated columns even though SELECT * returns them.
  const columns = yield query("SELECT name,hidden FROM pragma_table_xinfo(?)", [table]);
  if (!columns.length || columns.some((row) => typeof row.name !== "string" || ![0, 1, 2, 3].includes(row.hidden as number))
    || required.some((name) => !columns.some((row) => row.name === name && row.hidden === 0))) return fail(shapeError);
  const suffix = key === undefined ? "" : ' WHERE "key"=?', bindings = key === undefined ? [] : [key];
  // Expo returns SQLite INTEGER through a JS Number. Detect values it would round
  // inside SQLite, before requesting any rows containing those values.
  const unsafe = columns.filter((row) => row.hidden !== 1).map(({ name }) => `(typeof(${quoted(name as string)})='integer' AND (${quoted(name as string)}>9007199254740991 OR ${quoted(name as string)}< -9007199254740991))
    OR (typeof(${quoted(name as string)})='real' AND (${quoted(name as string)}>1.7976931348623157e308 OR ${quoted(name as string)}< -1.7976931348623157e308))`).join(" OR ");
  const unsupported = yield query(`SELECT 1 AS unsupported FROM ${quoted(table)}${suffix}${suffix ? " AND" : " WHERE"} (${unsafe}) LIMIT 1`, bindings);
  if (unsupported.length) return fail("R04_SOURCE_SQL_NUMBER_UNREPRESENTABLE");
  const rows = yield query(`SELECT * FROM ${quoted(table)}${suffix}${order.length ? ` ORDER BY ${order.map(quoted).join(",")}` : ""}`, bindings);
  const count = yield query(`SELECT count(*) AS n FROM ${quoted(table)}${suffix}`, bindings);
  if (count.length !== 1 || !Number.isSafeInteger(count[0]!.n) || rows.length !== count[0]!.n) return fail(coverageError);
  return rows.map((row) => ({ ...row }));
}
export { read as readLegacySourceTable };
export { present as legacySourceTablePresent };
