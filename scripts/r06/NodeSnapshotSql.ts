import type { DatabaseSync } from "node:sqlite";
import type { SnapshotSqlPort, SnapshotSqlValue } from "../../apps/mobile/src/features/backup/data/SnapshotSqlPort.ts";

/** Host driver for the very same snapshot engine used by the native adapter. */
export function nodeSnapshotSql(db: DatabaseSync): SnapshotSqlPort {
  db.exec("PRAGMA foreign_keys=ON");
  const port: SnapshotSqlPort = {
    async run(sql, bindings = []) {
      const result = db.prepare(sql).run(...bindings);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async first<Row>(sql: string, bindings: readonly SnapshotSqlValue[] = []): Promise<Row | null> {
      return (db.prepare(sql).get(...bindings) as Row | undefined) ?? null;
    },
    async all<Row>(sql: string, bindings: readonly SnapshotSqlValue[] = []): Promise<readonly Row[]> {
      return db.prepare(sql).all(...bindings) as Row[];
    },
    async *each<Row>(sql: string, bindings: readonly SnapshotSqlValue[] = []): AsyncIterable<Row> {
      for (const row of db.prepare(sql).iterate(...bindings)) yield row as Row;
    },
    async transaction<T>(task: (tx: SnapshotSqlPort) => Promise<T>): Promise<T> {
      db.exec("BEGIN IMMEDIATE");
      try { const result = await task(port); db.exec("COMMIT"); return result; }
      catch (error) { try { db.exec("ROLLBACK"); } catch { /* Keep original failure. */ } throw error; }
    },
  };
  return port;
}
