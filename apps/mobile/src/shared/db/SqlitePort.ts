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

/** Opening failed and its native reader could not close. The database owner must retain
 * this cleanup before admitting another open or any closed-file maintenance. */
export class SqliteOpenCloseError extends Error {
  readonly closeError: unknown;
  readonly retryClose: () => Promise<void>;
  constructor(cause: unknown, closeError: unknown, retryClose: () => Promise<void>) {
    super("DB_OPEN_CLOSE_FAILED", { cause });
    this.closeError = closeError;
    this.retryClose = retryClose;
  }
}
