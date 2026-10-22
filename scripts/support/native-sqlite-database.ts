import { DatabaseSync } from "node:sqlite";
import type { NativeSqliteDatabase } from "../../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import type { SqlValue } from "../../apps/mobile/src/shared/db/SqlitePort.ts";

/** Actual host SQLite behind the same async API surface consumed by the Expo adapter. */
export function nativeSqliteDatabase(file: string): NativeSqliteDatabase {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = OFF");
  return {
    async runAsync(sql: string, ...args: unknown[]) {
      const result = db.prepare(sql).run(...args as SqlValue[]);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync<Row>(sql: string, ...args: unknown[]) { return (db.prepare(sql).get(...args as SqlValue[]) as Row | undefined) ?? null; },
    async getAllAsync<Row>(sql: string, ...args: unknown[]) { return db.prepare(sql).all(...args as SqlValue[]) as Row[]; },
    async execAsync(sql: string) { db.exec(sql); },
    async closeAsync() { db.close(); },
  };
}
