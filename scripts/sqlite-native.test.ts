import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runMigrations, type MigrationStep } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from "../apps/mobile/src/shared/db/SqlitePort.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";

/** In-memory real SQLite adapter for infrastructure tests, never a production adapter. */
class NativeMemoryConnection implements SqliteConnectionPort {
  private readonly db = new DatabaseSync(":memory:");

  constructor() { this.db.exec("PRAGMA foreign_keys = ON"); }

  async run(sql: string, bindings: readonly SqlValue[] = []) {
    const result = this.db.prepare(sql).run(...bindings);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async first<Row>(sql: string, bindings: readonly SqlValue[] = []): Promise<Row | null> {
    return (this.db.prepare(sql).get(...bindings) as Row | undefined) ?? null;
  }

  async all<Row>(sql: string, bindings: readonly SqlValue[] = []): Promise<readonly Row[]> {
    return this.db.prepare(sql).all(...bindings) as Row[];
  }

  async exclusive<T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await task(this);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> { this.db.close(); }
}

const baseCatalog: readonly MigrationStep[] = [
  { version: 1, checksum: "test-001", statements: [
    "CREATE TABLE test_items (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
  ] },
  { version: 2, checksum: "test-002", statements: [
    "CREATE INDEX test_items_value_idx ON test_items(value)",
  ] },
];

test("real SQLite: forward migrations are applied once", async () => {
  const db = new NativeMemoryConnection();
  try {
    const writer = new WriterCoordinator(db);
    assert.deepEqual(await runMigrations(writer, baseCatalog), [1, 2]);
    assert.deepEqual(await runMigrations(writer, baseCatalog), []);
    const row = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations");
    assert.equal(row?.count, 2);
    await db.run("INSERT INTO test_items (id, value) VALUES (?, ?)", ["synthetic", "ok"]);
    assert.equal((await db.first<{ value: string }>("SELECT value FROM test_items WHERE id = ?", ["synthetic"]))?.value, "ok");
  } finally { await db.close(); }
});

test("real SQLite: failed migration rolls back DDL and history, then retries", async () => {
  const db = new NativeMemoryConnection();
  try {
    const writer = new WriterCoordinator(db);
    const broken: readonly MigrationStep[] = [
      baseCatalog[0]!,
      { version: 2, checksum: "bad", statements: [
        "INSERT INTO test_items (id, value) VALUES ('same', 'a')",
        "INSERT INTO test_items (id, value) VALUES ('same', 'b')",
      ] },
    ];
    await assert.rejects(runMigrations(writer, broken));
    const table = await db.first<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'test_items'");
    assert.equal(table, null);
    assert.deepEqual(await runMigrations(writer, baseCatalog), [1, 2]);
  } finally { await db.close(); }
});

test("real SQLite: checksum drift and unknown future version fail closed", async () => {
  const db = new NativeMemoryConnection();
  try {
    const writer = new WriterCoordinator(db);
    await runMigrations(writer, baseCatalog);
    await assert.rejects(runMigrations(writer, [
      { ...baseCatalog[0]!, checksum: "changed" }, baseCatalog[1]!,
    ]), /MIGRATION_HISTORY_MISMATCH/u);
    await db.run("INSERT INTO schema_migrations (version, checksum) VALUES (3, 'unknown')");
    await assert.rejects(runMigrations(writer, baseCatalog), /MIGRATION_HISTORY_MISMATCH/u);
  } finally { await db.close(); }
});

test("real SQLite: deferred FK violation aborts a migration batch", async () => {
  const db = new NativeMemoryConnection();
  try {
    const writer = new WriterCoordinator(db);
    const invalid: readonly MigrationStep[] = [{ version: 1, checksum: "fk-test", statements: [
      "CREATE TABLE parent (id INTEGER PRIMARY KEY)",
      "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)",
      "INSERT INTO child (id, parent_id) VALUES (1, 999)",
    ] }];
    await assert.rejects(runMigrations(writer, invalid), /MIGRATION_FOREIGN_KEY_VIOLATION/u);
    assert.equal(await db.first("SELECT name FROM sqlite_master WHERE name = 'child'"), null);
  } finally { await db.close(); }
});

test("real SQLite: writer order and maintenance quiescence", async () => {
  const db = new NativeMemoryConnection();
  try {
    const writer = new WriterCoordinator(db);
    await runMigrations(writer, baseCatalog);
    const writes = ["first", "second"].map((id) => writer.write(async (tx) => {
      await Promise.resolve();
      await tx.run("INSERT INTO test_items (id, value) VALUES (?, ?)", [id, id]);
    }));
    const resume = await writer.quiesce();
    await Promise.all(writes);
    await assert.rejects(writer.write(async () => undefined), /WRITES_QUIESCED/u);
    const rowsBefore = await db.all<{ id: string }>("SELECT id FROM test_items ORDER BY rowid");
    assert.deepEqual(rowsBefore.map((row) => row.id), ["first", "second"]);
    resume();
    await writer.write((tx) => tx.run("INSERT INTO test_items (id, value) VALUES (?, ?)", ["third", "third"]));
    const count = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM test_items");
    assert.equal(count?.count, 3);
  } finally { await db.close(); }
});
