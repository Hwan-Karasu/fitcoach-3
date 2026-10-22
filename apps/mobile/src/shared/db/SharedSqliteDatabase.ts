import type { SqliteConnectionPort, SqlValue } from "./SqlitePort.ts";
import { WriterCoordinator } from "./WriterCoordinator.ts";

export interface SqliteDatabaseLease {
  readonly connection: SqliteConnectionPort;
  readonly writer: WriterCoordinator;
}

interface ConnectionState {
  readonly raw: SqliteConnectionPort;
  readonly lease: SqliteDatabaseLease;
  readonly pending: Set<Promise<unknown>>;
  accepting: boolean;
  pause: Promise<() => void> | null;
}

/** One physical file/connection/writer queue. Last release waits for admitted reads
 * as well as queued transactions; lifecycle transitions never overlap native handles. */
export class SharedSqliteDatabase {
  private state: ConnectionState | null = null;
  private holders = 0;
  private lifecycle: Promise<void> = Promise.resolve();
  private maintenance: "ACTIVE" | "RECOVERY_REQUIRED" | null = null;
  private closeFailed = false;
  private readonly open: () => Promise<SqliteConnectionPort>;

  constructor(open: () => Promise<SqliteConnectionPort>) {
    this.open = open;
  }

  acquire(): Promise<SqliteDatabaseLease> {
    return this.serial(async () => {
      this.assertAvailable();
      if (this.state === null) this.state = this.wrap(await this.open());
      this.holders += 1;
      return this.state.lease;
    });
  }

  /** Last release permanently retires the lease; the next acquisition opens a fresh handle. */
  release(): Promise<void> {
    return this.serial(async () => {
      if (this.holders === 0) return;
      this.holders -= 1;
      if (this.holders > 0 || this.state === null) return;
      const state = this.state;
      state.accepting = false;
      try {
        await this.pause(state);
        await Promise.allSettled([...state.pending]);
        await state.raw.close();
        this.state = null;
      } catch {
        this.closeFailed = true;
        throw new Error("DATABASE_CLOSE_FAILED");
      }
    });
  }

  /** R06 boundary. Caller prevents new business commands and pauses scheduler first.
   * stopHolders finishes pending initialization/reads and releases every repository/workflow
   * lease without acquiring another. task runs ONLY after physical close.
   * Failure in task blocks admission until successful recovery maintenance.
   */
  async withClosedDatabase<T>(stopHolders: () => Promise<void>, task: () => Promise<T>): Promise<T> {
    if (this.maintenance === "ACTIVE") throw new Error("DATABASE_MAINTENANCE_BUSY");
    if (this.closeFailed) throw new Error("DATABASE_CLOSE_FAILED");
    const recovering = this.maintenance === "RECOVERY_REQUIRED";
    this.maintenance = "ACTIVE";
    let taskStarted = false;
    let succeeded = false;
    let paused: ConnectionState | null = null;
    let resume: (() => void) | null = null;
    try {
      await this.serial(async () => undefined);
      paused = this.state;
      if (paused !== null) resume = await this.pause(paused);
      await stopHolders();
      await this.serial(async () => {
        if (this.closeFailed) throw new Error("DATABASE_CLOSE_FAILED");
        if (this.holders !== 0 || this.state !== null) throw new Error("DATABASE_LEASES_REMAIN");
      });
      taskStarted = true;
      const result = await task();
      succeeded = true;
      return result;
    } finally {
      if (!taskStarted && paused !== null && paused.accepting && resume !== null) {
        resume();
        paused.pause = null;
      }
      this.maintenance = !succeeded && (taskStarted || recovering) ? "RECOVERY_REQUIRED" : null;
    }
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(task);
    this.lifecycle = result.then(() => undefined, () => undefined);
    return result;
  }
  private assertAvailable(): void {
    if (this.closeFailed) throw new Error("DATABASE_CLOSE_FAILED");
    if (this.maintenance !== null) throw new Error(this.maintenance === "ACTIVE" ? "DATABASE_MAINTENANCE" : "DATABASE_RECOVERY_REQUIRED");
  }
  private pause(state: ConnectionState): Promise<() => void> {
    if (state.pause === null) {
      const pausing = state.lease.writer.quiesce();
      state.pause = pausing;
      void pausing.catch(() => { if (state.pause === pausing) state.pause = null; });
    }
    return state.pause;
  }
  private wrap(raw: SqliteConnectionPort): ConnectionState {
    const pending = new Set<Promise<unknown>>();
    // Writer admission is governed by quiesce: previously queued transactions must finish.
    // Transaction-internal statements are covered by the entire exclusive callback promise.
    const track = <T>(task: () => Promise<T>): Promise<T> => {
      const result = Promise.resolve().then(task);
      pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    };
    const internal: SqliteConnectionPort = {
      run: (sql, bindings) => track(() => raw.run(sql, bindings)),
      first: <Row>(sql: string, bindings?: readonly SqlValue[]) => track(() => raw.first<Row>(sql, bindings)),
      all: <Row>(sql: string, bindings?: readonly SqlValue[]) => track(() => raw.all<Row>(sql, bindings)),
      exclusive: (task) => track(() => raw.exclusive(task)),
      close: async () => { throw new Error("DATABASE_RELEASE_REQUIRED"); },
    };
    const check = <T>(task: () => Promise<T>): Promise<T> => {
      try {
        if (!state.accepting) throw new Error("DATABASE_LEASE_RELEASED");
        this.assertAvailable();
        return task();
      } catch (error) { return Promise.reject(error); }
    };
    const connection: SqliteConnectionPort = {
      run: (sql, bindings) => check(() => internal.run(sql, bindings)),
      first: <Row>(sql: string, bindings?: readonly SqlValue[]) => check(() => internal.first<Row>(sql, bindings)),
      all: <Row>(sql: string, bindings?: readonly SqlValue[]) => check(() => internal.all<Row>(sql, bindings)),
      exclusive: (task) => check(() => internal.exclusive(task)),
      close: internal.close,
    };
    const state: ConnectionState = { raw, pending, lease: { connection, writer: new WriterCoordinator(internal, undefined, () => {
      if (!state.accepting) throw new Error("DATABASE_LEASE_RELEASED");
      this.assertAvailable();
    }) }, accepting: true, pause: null };
    return state;
  }
}
