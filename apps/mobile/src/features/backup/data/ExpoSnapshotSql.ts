import type { SQLiteDatabase } from "expo-sqlite";
import type { SnapshotSqlPort, SnapshotSqlValue } from "./SnapshotSqlPort.ts";

/** Exclusive private connection. BEGIN/COMMIT use this exact handle, including FK settings.
 * Native withExclusiveTransactionAsync may allocate another handle; do not use it here. */
export function expoSnapshotSql(db: SQLiteDatabase): SnapshotSqlPort {
  let transactionActive = false;
  const port: SnapshotSqlPort = {
    async run(sql, bindings = []) {
      const result = await db.runAsync(sql, [...bindings]);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    first: <Row>(sql: string, bindings: readonly SnapshotSqlValue[] = []) => db.getFirstAsync<Row>(sql, [...bindings]),
    all: <Row>(sql: string, bindings: readonly SnapshotSqlValue[] = []) => db.getAllAsync<Row>(sql, [...bindings]),
    each: <Row>(sql: string, bindings: readonly SnapshotSqlValue[] = []) => db.getEachAsync<Row>(sql, [...bindings]),
    async transaction<T>(task: (tx: SnapshotSqlPort) => Promise<T>): Promise<T> {
      if (transactionActive) throw new Error("SNAPSHOT_TRANSACTION_BUSY");
      transactionActive = true;
      try {
        await db.execAsync("BEGIN IMMEDIATE");
        try { const result = await task(port); await db.execAsync("COMMIT"); return result; }
        catch (error) { try { await db.execAsync("ROLLBACK"); } catch { /* Preserve original failure. */ } throw error; }
      } finally { transactionActive = false; }
    },
  };
  return port;
}
