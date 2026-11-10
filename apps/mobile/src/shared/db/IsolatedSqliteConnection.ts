import type * as SQLite from "expo-sqlite";
import { SqliteOpenCloseError, type SqliteConnectionPort, type SqliteStatementPort, type SqlValue } from "./SqlitePort.ts";
import { navigationPerformance } from "../diagnostics/NavigationPerformance.ts";

export type NativeSqliteDatabase = Pick<SQLite.SQLiteDatabase,
  "runAsync" | "getFirstAsync" | "getAllAsync" | "execAsync" | "closeAsync">;

function statements(native: NativeSqliteDatabase): SqliteStatementPort {
  return {
    async run(sql: string, bindings: readonly SqlValue[] = []) {
      const result = await native.runAsync(sql, ...bindings);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    first: <Row>(sql: string, bindings: readonly SqlValue[] = []) => {
      const end = navigationPerformance.read(sql); return native.getFirstAsync<Row>(sql, ...bindings).finally(end);
    },
    all: <Row>(sql: string, bindings: readonly SqlValue[] = []) => {
      const end = navigationPerformance.read(sql); return native.getAllAsync<Row>(sql, ...bindings).finally(end);
    },
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

/** Writes use a separate private handle, configured (foreign_keys, WAL) before its first BEGIN. The shared writer queues tasks per file.
 * Expo's withExclusiveTransactionAsync also opens a new handle, but starts BEGIN before its callback;
 * enabling foreign_keys inside that callback would silently have no effect.
 * WRITE-PATH-1: the write handle is opened once and reused (раньше — новое соединение и 4 PRAGMA на каждую запись подхода). A handle
 * whose transaction could not be closed (failed ROLLBACK) is retired; a new writer opens only after its physical close succeeds.
 */
export async function openIsolatedSqliteConnection(open: () => Promise<NativeSqliteDatabase>,
  inspectBeforeWrite?: (reader: SqliteStatementPort) => Promise<unknown>): Promise<SqliteConnectionPort> {
  const reader = await open();
  let writer: NativeSqliteDatabase | null = null;
  let writerBroken = false;
  let readerClosed = false;
  let retiring = false;
  const discardWriter = async () => {
    const stale = writer;
    if (stale === null) return;
    writerBroken = true;
    try { await stale.closeAsync(); writer = null; writerBroken = false; }
    catch { /* Keep the unclosed handle: maintenance must retry its close, never replace the file under it. */ }
  };
  const writeHandle = async (): Promise<NativeSqliteDatabase> => {
    if (retiring) throw new Error("DB_CONNECTION_CLOSED");
    if (writerBroken) throw new Error("DB_WRITER_UNAVAILABLE");
    if (writer !== null) return writer;
    const native = await open();
    try { await configure(native, false); }
    catch (error) {
      try { await native.closeAsync(); }
      catch { writer = native; writerBroken = true; }
      throw error;
    }
    writer = native;
    return native;
  };
  try {
    if (inspectBeforeWrite) await inspectBeforeWrite(statements(reader));
    await configure(reader, true);
    return {
      ...statements(reader),
      async exclusive<T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> {
        const native = await writeHandle();
        let begun = false;
        try {
          await native.execAsync("BEGIN IMMEDIATE");
          begun = true;
          const result = await task(statements(native));
          await native.execAsync("COMMIT");
          begun = false;
          return result;
        } catch (error) {
          if (begun) {
            try { await native.execAsync("ROLLBACK"); } catch { await discardWriter(); }
          }
          throw error;
        }
      },
      // Сбой закрытия handle записи не глушится: release/restore R06 должны отказать, а не заменять файл под открытым handle.
      close: async () => {
        retiring = true;
        const open = writer;
        try {
          if (open !== null) { await open.closeAsync(); writer = null; writerBroken = false; }
        } finally {
          if (!readerClosed) { await reader.closeAsync(); readerClosed = true; }
        }
      },
    };
  } catch (error) {
    try { await reader.closeAsync(); }
    catch (closeError) { throw new SqliteOpenCloseError(error, closeError, () => reader.closeAsync()); }
    throw error;
  }
}
