/** Internal database boundary. Feature UI must never receive this handle. */
export type SqlValue = string | number | null;

export interface SqliteStatementPort {
  run(sql: string, bindings?: readonly SqlValue[]): Promise<{ readonly changes: number; readonly lastInsertRowId: number }>;
  first<Row>(sql: string, bindings?: readonly SqlValue[]): Promise<Row | null>;
  all<Row>(sql: string, bindings?: readonly SqlValue[]): Promise<readonly Row[]>;
}

export interface SqliteConnectionPort extends SqliteStatementPort {
  /** All statements in the callback share one exclusive transaction. */
  exclusive<T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
