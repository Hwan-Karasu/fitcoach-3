import * as SQLite from "expo-sqlite";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from "./SqlitePort.ts";

type NativeStatements = Pick<SQLite.SQLiteDatabase, "runAsync" | "getFirstAsync" | "getAllAsync">;

function statements(native: NativeStatements): SqliteStatementPort {
  return {
    async run(sql: string, bindings: readonly SqlValue[] = []) {
      const result = await native.runAsync(sql, ...bindings);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    first<Row>(sql: string, bindings: readonly SqlValue[] = []) {
      return native.getFirstAsync<Row>(sql, ...bindings);
    },
    all<Row>(sql: string, bindings: readonly SqlValue[] = []) {
      return native.getAllAsync<Row>(sql, ...bindings);
    },
  };
}

/** Candidate runtime adapter; not connected to App boot until F03/D01 gates. */
export async function openExpoSqliteConnection(databaseName: string): Promise<SqliteConnectionPort> {
  if (!/^[a-zA-Z0-9_-]+\.db$/u.test(databaseName)) throw new Error("DB_NAME_INVALID");
  const native = await SQLite.openDatabaseAsync(databaseName);
  try {
    await native.execAsync("PRAGMA foreign_keys = ON");
    const fk = await native.getFirstAsync<{ foreign_keys: number }>("PRAGMA foreign_keys");
    if (fk?.foreign_keys !== 1) throw new Error("DB_FOREIGN_KEYS_UNAVAILABLE");
    await native.execAsync("PRAGMA journal_mode = WAL");
    const journal = await native.getFirstAsync<{ journal_mode: string }>("PRAGMA journal_mode");
    if (journal?.journal_mode.toLowerCase() !== "wal") throw new Error("DB_WAL_UNAVAILABLE");
    return {
      ...statements(native),
      async exclusive<T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> {
        let result!: T;
        await native.withExclusiveTransactionAsync(async (tx) => { result = await task(statements(tx)); });
        return result;
      },
      close: () => native.closeAsync(),
    };
  } catch (error) {
    await native.closeAsync();
    throw error;
  }
}
