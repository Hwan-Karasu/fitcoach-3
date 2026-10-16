import type { SqliteConnectionPort, SqliteStatementPort } from "./SqlitePort.ts";
import type { DiagnosticInput, DiagnosticSink } from "../diagnostics/LocalDiagnostics.ts";

/** One instance per physical database file. A rejected write does not poison the queue. */
export class WriterCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private paused = false;
  private readonly connection: SqliteConnectionPort;
  private readonly diagnostics?: DiagnosticSink;

  constructor(connection: SqliteConnectionPort, diagnostics?: DiagnosticSink) {
    this.connection = connection;
    this.diagnostics = diagnostics;
  }

  write<T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> {
    if (this.paused) {
      this.report({ operation: "db.transaction", outcome: "rejected", durationMs: 0, code: "WRITES_QUIESCED" });
      return Promise.reject(new Error("WRITES_QUIESCED"));
    }
    const result = this.tail.then(async () => {
      const started = performance.now();
      try {
        const value = await this.connection.exclusive(task);
        this.report({ operation: "db.transaction", outcome: "committed", durationMs: performance.now() - started });
        return value;
      } catch (error) {
        this.report({ operation: "db.transaction", outcome: "rolled-back", durationMs: performance.now() - started, code: "DB_WRITE_FAILED" });
        throw error;
      }
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Wait for writes already enqueued; does not prevent new writes. */
  async drain(): Promise<void> { await this.tail; }

  /** Reject new writes, wait for the queue, then let the caller perform guarded maintenance. */
  async quiesce(): Promise<() => void> {
    if (this.paused) throw new Error("WRITES_ALREADY_QUIESCED");
    this.paused = true;
    await this.tail;
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.paused = false;
    };
  }

  private report(event: DiagnosticInput): void {
    try { this.diagnostics?.record(event); }
    catch { /* Diagnostics cannot change a business transaction result. */ }
  }
}
