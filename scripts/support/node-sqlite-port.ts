import { DatabaseSync } from "node:sqlite";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from
  "../../apps/mobile/src/shared/db/SqlitePort.ts";

/** Host-side adapter for synthetic integration tests; never used by the mobile runtime. */
export function nodeSqlitePort(db: DatabaseSync): SqliteConnectionPort {
  db.exec("PRAGMA foreign_keys = ON");
  const statements: SqliteStatementPort = {
    run: async (sql: string, bindings: readonly SqlValue[] = []) => {
      const result = db.prepare(sql).run(...bindings);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    first: async <Row>(sql: string, bindings: readonly SqlValue[] = []): Promise<Row | null> =>
      (db.prepare(sql).get(...bindings) as Row | undefined) ?? null,
    all: async <Row>(sql: string, bindings: readonly SqlValue[] = []): Promise<readonly Row[]> =>
      db.prepare(sql).all(...bindings) as Row[],
  };
  return {
    ...statements,
    exclusive: async <T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> => {
      db.exec("BEGIN IMMEDIATE");
      try { const value = await task(statements); db.exec("COMMIT"); return value; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    close: async () => { db.close(); },
  };
}
