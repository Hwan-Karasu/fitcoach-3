import type { SharedSqliteDatabase, SqliteDatabaseLease } from "../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteStatementPort } from "../../shared/db/SqlitePort.ts";

/** Workflow commands share one owned lease, released during maintenance. A rejected acquire
 * is never cached forever. Drain admitted operations before closing the shared database. */
export class WorkflowDatabaseLease {
  private readonly database: SharedSqliteDatabase;
  private lease: Promise<SqliteDatabaseLease> | null = null;
  private accepting = true;
  private closing: Promise<void> | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  constructor(database: SharedSqliteDatabase) { this.database = database; }
  private acquire(): Promise<SqliteDatabaseLease> {
    if (this.lease !== null) return this.lease;
    const opening = this.database.acquire(); this.lease = opening;
    void opening.catch(() => { if (this.lease === opening) this.lease = null; });
    return opening;
  }
  write<T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error("WORKFLOW_MAINTENANCE"));
    const running = Promise.resolve().then(async () => (await this.acquire()).writer.write(task));
    this.pending.add(running);
    void running.then(() => this.pending.delete(running), () => this.pending.delete(running));
    return running;
  }
  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.accepting = false;
    const closing = (async () => {
      while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
      const opening = this.lease;
      if (opening !== null) {
        // Failed acquire owns no holder. An uncertain release is deliberately not retried.
        const lease = await opening.catch(() => null);
        this.lease = null;
        if (lease !== null) await this.database.release();
      }
    })();
    this.closing = closing;
    return closing;
  }
  resume(): void {
    // The lifecycle caller waits for close before reopening.
    this.closing = null; this.accepting = true;
  }
}
