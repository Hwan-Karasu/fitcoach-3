import type * as SQLite from "expo-sqlite";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from "./SqlitePort.ts";

export type NativeSqliteDatabase = Pick<SQLite.SQLiteDatabase,
  "runAsync" | "getFirstAsync" | "getAllAsync" | "execAsync" | "closeAsync">;

function statements(native: NativeSqliteDatabase): SqliteStatementPort {
  return {
    async run(sql: string, bindings: readonly SqlValue[] = []) {
      const result = await native.runAsync(sql, ...bindings);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    first: <Row>(sql: string, bindings: readonly SqlValue[] = []) => native.getFirstAsync<Row>(sql, ...bindings),
    all: <Row>(sql: string, bindings: readonly SqlValue[] = []) => native.getAllAsync<Row>(sql, ...bindings),
  };
}

async function configure(native: NativeSqliteDatabase, enableWal: boolean): Promise<void> {
  // SQLite ignores attempts to enable foreign_keys after BEGIN. Configure the private handle first.
  await native.execAsync("PRAGMA foreign_keys = ON");
  if ((await native.getFirstAsync<{ foreign_keys: number }>("PRAGMA foreign_keys"))?.foreign_keys !== 1) {
    throw new Error("DB_FOREIGN_KEYS_UNAVAILABLE");
  }
  if (enableWal) await native.execAsync("PRAGMA journal_mode = WAL");
  if ((await native.getFirstAsync<{ journal_mode: string }>("PRAGMA journal_mode"))?.journal_mode.toLowerCase() !== "wal") {
    throw new Error("DB_WAL_UNAVAILABLE");
  }
}

/** Every write owns a new physical handle, configured before BEGIN. The shared writer queues tasks per file.
 * Expo's withExclusiveTransactionAsync also opens a new handle, but starts BEGIN before its callback;
 * enabling foreign_keys inside that callback would silently have no effect.
 */
export async function openIsolatedSqliteConnection(open: () => Promise<NativeSqliteDatabase>): Promise<SqliteConnectionPort> {
  const reader = await open();
  try {
    await configure(reader, true);
    return {
      ...statements(reader),
      async exclusive<T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> {
        const native = await open();
        let begun = false;
        try {
          await configure(native, false);
          await native.execAsync("BEGIN IMMEDIATE");
          begun = true;
          const result = await task(statements(native));
          await native.execAsync("COMMIT");
          begun = false;
          return result;
        } catch (error) {
          if (begun) {
            try { await native.execAsync("ROLLBACK"); } catch { /* Preserve the original failure. */ }
          }
          throw error;
        } finally { await native.closeAsync(); }
      },
      close: () => reader.closeAsync(),
    };
  } catch (error) {
    await reader.closeAsync();
    throw error;
  }
}
