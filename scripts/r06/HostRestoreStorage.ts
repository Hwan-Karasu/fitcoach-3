import { createHash } from "node:crypto";
import { constants, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RestoreGuard, RestoreSlot, RestoreStorage } from "../../apps/mobile/src/features/backup/public.ts";
import { inspectProductionDatabase } from "../../apps/mobile/src/app/composition/productionDatabase.ts";
import { nodeSqlitePort } from "../support/node-sqlite-port.ts";

/** Host-only R06 adapter for closed synthetic DBs. Not an Android durability proof. */
export class HostRestoreStorage implements RestoreStorage {
  private tail: Promise<void> = Promise.resolve();
  private locked = false;
  readonly directory: string;
  readonly onBoundary: (event: string) => void;
  constructor(directory: string, onBoundary: (event: string) => void = () => undefined) {
    this.directory = directory;
    this.onBoundary = onBoundary;
    mkdirSync(join(directory, "restore"), { recursive: true });
  }
  path(slot: RestoreSlot): string {
    return slot === "LIVE" ? join(this.directory, "live.db") : join(this.directory, "restore", `${slot.toLowerCase()}.db`);
  }
  guardPath(): string { return join(this.directory, "restore", "guard.json"); }
  async withClosedDatabase<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      // Tests only use already-closed DELETE-journal files. Never copy an open WAL file.
      for (const slot of ["LIVE", "INCOMING", "SAFETY", "PREVIOUS", "REJECTED", "ROLLBACK"] as const) {
        for (const suffix of ["-wal", "-shm", "-journal"]) {
          if (existsSync(`${this.path(slot)}${suffix}`)) throw new Error("R06_SIDECAR_PRESENT");
        }
      }
      this.locked = true;
      return await task();
    } finally { this.locked = false; unlock(); }
  }
  async loadGuard(): Promise<unknown | null> {
    this.assertLocked();
    return existsSync(this.guardPath()) ? JSON.parse(readFileSync(this.guardPath(), "utf8")) as unknown : null;
  }
  async saveGuard(guard: RestoreGuard): Promise<void> {
    this.assertLocked();
    const pending = `${this.guardPath()}.next`;
    const fd = openSync(pending, "w", 0o600);
    try { writeFileSync(fd, JSON.stringify(guard)); fsyncSync(fd); }
    finally { closeSync(fd); }
    this.onBoundary(`guard-pending:${guard.phase}`);
    renameSync(pending, this.guardPath());
    // Windows does not expose portable directory fsync; only process-death is tested here.
    this.onBoundary(`guard:${guard.phase}`);
  }
  async sha256(slot: RestoreSlot): Promise<string | null> {
    this.assertLocked();
    return existsSync(this.path(slot)) ? createHash("sha256").update(readFileSync(this.path(slot))).digest("hex") : null;
  }
  async validateDatabase(slot: RestoreSlot): Promise<void> {
    this.assertLocked();
    const db = new DatabaseSync(this.path(slot), { readOnly: true });
    try {
      if (await inspectProductionDatabase(nodeSqlitePort(db)) !== "OWNED") throw new Error("R06_INVALID_DATABASE");
    } finally { db.close(); }
    this.onBoundary(`validated:${slot}`);
  }
  async copyExclusive(from: RestoreSlot, to: RestoreSlot): Promise<void> {
    this.assertLocked();
    copyFileSync(this.path(from), this.path(to), constants.COPYFILE_EXCL);
    const fd = openSync(this.path(to), "r+");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    this.onBoundary(`copy:${from}:${to}`);
  }
  async moveExclusive(from: RestoreSlot, to: RestoreSlot): Promise<void> {
    this.assertLocked();
    if (existsSync(this.path(to))) throw new Error("R06_DESTINATION_EXISTS");
    renameSync(this.path(from), this.path(to));
    this.onBoundary(`move:${from}:${to}`);
  }
  private assertLocked(): void { if (!this.locked) throw new Error("R06_DATABASE_NOT_QUIESCED"); }
}
