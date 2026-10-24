import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { NativeSqliteDatabase } from "../../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";

export type LegacyNativeCall = { kind: "open" | "all" | "first" | "run" | "exec" | "close"; sql: string; handle: number };
export function nativeFactory(path: string) {
  const calls: LegacyNativeCall[] = [], handles = new Set<number>(); let next = 0;
  const state: { fail?: (call: LegacyNativeCall) => boolean; after?: (call: LegacyNativeCall, db: DatabaseSync) => void } = {};
  function call(kind: LegacyNativeCall["kind"], sql: string, handle: number) {
    const value = { kind, sql, handle }; calls.push(value);
    if (state.fail?.(value)) throw new Error("PRIVATE native SQLite detail");
    return value;
  }
  const open = async (): Promise<NativeSqliteDatabase> => {
    const handle = ++next; call("open", "", handle); const db = new DatabaseSync(path); handles.add(handle);
    return {
      getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
        const value = call("all", sql, handle); await Promise.resolve(); const result = db.prepare(sql).all(...bindings as SQLInputValue[]) as Row[]; state.after?.(value, db); return result;
      },
      getFirstAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row | null> => {
        const value = call("first", sql, handle); await Promise.resolve(); const result = db.prepare(sql).get(...bindings as SQLInputValue[]) as Row | undefined; state.after?.(value, db); return result ?? null;
      },
      runAsync: async (sql: string, ...bindings: unknown[]) => {
        const value = call("run", sql, handle); await Promise.resolve(); const result = db.prepare(sql).run(...bindings as SQLInputValue[]); state.after?.(value, db);
        return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
      },
      execAsync: async (sql) => { const value = call("exec", sql, handle); await Promise.resolve(); db.exec(sql); state.after?.(value, db); },
      closeAsync: async () => { db.close(); handles.delete(handle); const value = call("close", "", handle); state.after?.(value, db); },
    };
  };
  return { open, state, calls, handles };
}
