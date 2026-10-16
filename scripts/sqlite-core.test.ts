import assert from "node:assert/strict";
import { runMigrations, type MigrationStep } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from "../apps/mobile/src/shared/db/SqlitePort.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";

class MemoryConnection implements SqliteConnectionPort {
  history = new Map<number, string>();
  failStatement: string | null = null;
  foreignKeyViolations = false;
  active = 0;
  peak = 0;

  async run(sql: string, bindings: readonly SqlValue[] = []) {
    if (sql === this.failStatement) throw new Error("INJECTED_FAILURE");
    if (sql.startsWith("INSERT INTO schema_migrations")) this.history.set(Number(bindings[0]), String(bindings[1]));
    return { changes: 1, lastInsertRowId: 0 };
  }

  async first<Row>(sql: string): Promise<Row | null> {
    assert.equal(sql, "PRAGMA integrity_check");
    return { integrity_check: "ok" } as Row;
  }

  async all<Row>(sql: string): Promise<readonly Row[]> {
    if (sql.startsWith("SELECT version, checksum")) {
      return [...this.history].map(([version, checksum]) => ({ version, checksum })) as Row[];
    }
    if (sql === "PRAGMA foreign_key_check" && this.foreignKeyViolations) return [{} as Row];
    return [];
  }

  async exclusive<T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> {
    const before = new Map(this.history);
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try { return await task(this); }
    catch (error) { this.history = before; throw error; }
    finally { this.active -= 1; }
  }

  async close(): Promise<void> {}
}

const catalog: readonly MigrationStep[] = [
  { version: 1, checksum: "synthetic-a", statements: ["CREATE SYNTHETIC A"] },
  { version: 2, checksum: "synthetic-b", statements: ["CREATE SYNTHETIC B"] },
];

const db = new MemoryConnection();
const writer = new WriterCoordinator(db);
assert.deepEqual(await runMigrations(writer, catalog), [1, 2]);
assert.deepEqual(await runMigrations(writer, catalog), []);
assert.equal(db.history.size, 2);

const failed = new MemoryConnection();
failed.failStatement = "CREATE SYNTHETIC B";
await assert.rejects(runMigrations(new WriterCoordinator(failed), catalog), /INJECTED_FAILURE/u);
assert.equal(failed.history.size, 0, "failed batch rolls back its migration ledger");
failed.failStatement = null;
assert.deepEqual(await runMigrations(new WriterCoordinator(failed), catalog), [1, 2]);

const drift = new MemoryConnection();
drift.history.set(1, "other-checksum");
await assert.rejects(runMigrations(new WriterCoordinator(drift), catalog), /MIGRATION_HISTORY_MISMATCH/u);
assert.equal(drift.history.size, 1);

const fk = new MemoryConnection();
fk.foreignKeyViolations = true;
await assert.rejects(runMigrations(new WriterCoordinator(fk), catalog), /MIGRATION_FOREIGN_KEY_VIOLATION/u);
assert.equal(fk.history.size, 0);

await assert.rejects(runMigrations(new WriterCoordinator(new MemoryConnection()), [catalog[1]!]), /MIGRATION_CATALOG_INVALID/u);

const serialized = new MemoryConnection();
const serialWriter = new WriterCoordinator(serialized);
const order: number[] = [];
await Promise.all([1, 2, 3].map((number) => serialWriter.write(async () => {
  order.push(number);
  await Promise.resolve();
  return number;
})));
await serialWriter.drain();
assert.deepEqual(order, [1, 2, 3]);
assert.equal(serialized.peak, 1);
console.log("SQLite core candidate: 6/6 synthetic checks passed");
