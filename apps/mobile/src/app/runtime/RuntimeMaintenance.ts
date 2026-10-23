import type { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { RuntimeBusyError, type RuntimeCommandGate } from "./RuntimeCommandGate.ts";

export type RuntimeMaintenanceState = "ACTIVE" | "DRAINING" | "CLOSED" | "REOPENING" | "RECOVERY_REQUIRED";
interface Options {
  readonly database: SharedSqliteDatabase;
  readonly commands: RuntimeCommandGate;
  readonly drainBackground: () => Promise<void>;
  readonly closeOwners: () => Promise<void>;
  readonly reopen: () => Promise<void>;
  readonly invalidate: () => void;
  /** Cold-start recovery precedes normal boot; it must not initialize repositories itself. */
  readonly shouldReopen?: () => boolean;
}
/** Admission → whole-command/background drain → owner release → physical close → file
 * operation → normal initialize → cache reset → admission. Failure keeps UI/commands closed
 * until a successful recovery operation. Never opens a second runtime handle to work around it. */
export class RuntimeMaintenance {
  private readonly options: Options;
  private current: RuntimeMaintenanceState = "ACTIVE";
  private readonly listeners = new Set<(state: RuntimeMaintenanceState) => void>();
  constructor(options: Options) { this.options = options; }
  get state(): RuntimeMaintenanceState { return this.current; }
  subscribe(listener: (state: RuntimeMaintenanceState) => void): () => void {
    this.listeners.add(listener); try { listener(this.current); } catch { /* Observer only. */ }
    return () => this.listeners.delete(listener);
  }
  async withClosedDatabase<T>(task: () => Promise<T>): Promise<T> {
    if (this.current !== "ACTIVE" && this.current !== "RECOVERY_REQUIRED") throw new RuntimeBusyError();
    this.options.commands.pause(); this.publish("DRAINING");
    try {
      await this.options.commands.idle();
      await this.options.drainBackground();
      const result = await this.options.database.withClosedDatabase(this.options.closeOwners, async () => {
        this.publish("CLOSED"); return task();
      });
      if (this.options.shouldReopen?.() !== false) {
        this.publish("REOPENING");
        await this.options.reopen();
      }
      this.options.invalidate();
      this.options.commands.resume(); this.publish("ACTIVE");
      return result;
    } catch {
      this.publish("RECOVERY_REQUIRED");
      throw new Error("RUNTIME_RECOVERY_REQUIRED");
    }
  }
  private publish(state: RuntimeMaintenanceState): void {
    this.current = state;
    for (const listener of this.listeners) try { listener(state); } catch { /* Observer only. */ }
  }
}
