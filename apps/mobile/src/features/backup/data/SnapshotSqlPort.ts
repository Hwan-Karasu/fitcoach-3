/** Privileged snapshot-only boundary. BLOB bindings do not escape into feature UI. */
export type SnapshotSqlValue = string | number | null | Uint8Array;
export interface SnapshotSqlPort {
  run(sql: string, bindings?: readonly SnapshotSqlValue[]): Promise<{ readonly changes: number; readonly lastInsertRowId: number }>;
  first<Row>(sql: string, bindings?: readonly SnapshotSqlValue[]): Promise<Row | null>;
  all<Row>(sql: string, bindings?: readonly SnapshotSqlValue[]): Promise<readonly Row[]>;
  each<Row>(sql: string, bindings?: readonly SnapshotSqlValue[]): AsyncIterable<Row>;
  transaction<T>(task: (tx: SnapshotSqlPort) => Promise<T>): Promise<T>;
}
