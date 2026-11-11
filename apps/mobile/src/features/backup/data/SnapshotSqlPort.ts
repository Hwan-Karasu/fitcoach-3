/** Privileged snapshot-only boundary. BLOB bindings do not escape into feature UI. */
export type SnapshotSqlValue = string | number | null | Uint8Array;
/** Необязательное нативное вычисление канонического хеша содержимого именно этого файла (BKP-AUDIT-1 C5). null — недоступно или
 * сбой: вызывающий обязан посчитать JS-путём. Нативный результат никогда не объявляет копию повреждённой — только JS. */
export interface NativeContentHash { sha256(excluded: readonly string[]): Promise<string | null> }
export interface SnapshotSqlPort {
  readonly nativeContent?: NativeContentHash;
  run(sql: string, bindings?: readonly SnapshotSqlValue[]): Promise<{ readonly changes: number; readonly lastInsertRowId: number }>;
  first<Row>(sql: string, bindings?: readonly SnapshotSqlValue[]): Promise<Row | null>;
  all<Row>(sql: string, bindings?: readonly SnapshotSqlValue[]): Promise<readonly Row[]>;
  each<Row>(sql: string, bindings?: readonly SnapshotSqlValue[]): AsyncIterable<Row>;
  transaction<T>(task: (tx: SnapshotSqlPort) => Promise<T>): Promise<T>;
}
