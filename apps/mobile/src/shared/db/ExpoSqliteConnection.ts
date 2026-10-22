import * as SQLite from "expo-sqlite";
import type { SqliteConnectionPort, SqliteStatementPort } from "./SqlitePort.ts";
import { openIsolatedSqliteConnection } from "./IsolatedSqliteConnection.ts";

/** Dev runtime adapter. Android crash/recovery and release remain separately gated. */
export async function openExpoSqliteConnection(databaseName: string,
  inspectBeforeWrite?: (reader: SqliteStatementPort) => Promise<unknown>): Promise<SqliteConnectionPort> {
  if (!/^[a-zA-Z0-9_-]+\.db$/u.test(databaseName)) throw new Error("DB_NAME_INVALID");
  return openIsolatedSqliteConnection(() => SQLite.openDatabaseAsync(databaseName, { useNewConnection: true }), inspectBeforeWrite);
}
