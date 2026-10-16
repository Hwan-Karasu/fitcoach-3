import type { SqliteConnectionPort } from "./SqlitePort.ts";
import { WriterCoordinator } from "./WriterCoordinator.ts";

export interface SqliteDatabaseLease {
  readonly connection: SqliteConnectionPort;
  readonly writer: WriterCoordinator;
}

/**
 * One physical file, one connection and one writer queue shared by every owner that stores
 * data in it, so cross-owner commands can commit in a single transaction.
 */
export class SharedSqliteDatabase {
  private lease: SqliteDatabaseLease | null = null;
  private opening: Promise<SqliteDatabaseLease> | null = null;
  private holders = 0;
  private readonly open: () => Promise<SqliteConnectionPort>;

  constructor(open: () => Promise<SqliteConnectionPort>) {
    this.open = open;
  }

  async acquire(): Promise<SqliteDatabaseLease> {
    if (this.lease === null) {
      this.opening ??= this.open().then((connection) => ({
        connection, writer: new WriterCoordinator(connection),
      }));
      try { this.lease = await this.opening; }
      finally { this.opening = null; }
    }
    this.holders += 1;
    return this.lease;
  }

  /** Closes the file after the last holder released it and queued writes drained. */
  async release(): Promise<void> {
    if (this.holders === 0) return;
    this.holders -= 1;
    if (this.holders > 0 || this.lease === null) return;
    const lease = this.lease;
    this.lease = null;
    await lease.writer.drain();
    await lease.connection.close();
  }
}
