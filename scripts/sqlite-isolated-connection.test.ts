import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openIsolatedSqliteConnection, type NativeSqliteDatabase } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import type { SqlValue } from "../apps/mobile/src/shared/db/SqlitePort.ts";

function nativeFactory(file: string) {
  const events: { handle: number; sql: string }[] = [];
  let handles = 0, closed = 0;
  let ignoreForeignKeys = false;
  const open = async (): Promise<NativeSqliteDatabase> => {
    const handle = ++handles;
    const db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys = OFF");
    return {
      async runAsync(sql: string, ...args: unknown[]) {
        const result = db.prepare(sql).run(...args as SqlValue[]);
        return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
      },
      async getFirstAsync<Row>(sql: string, ...args: unknown[]) { return (db.prepare(sql).get(...args as SqlValue[]) as Row | undefined) ?? null; },
      async getAllAsync<Row>(sql: string, ...args: unknown[]) { return db.prepare(sql).all(...args as SqlValue[]) as Row[]; },
      async execAsync(sql: string) {
        events.push({ handle, sql });
        if (ignoreForeignKeys && sql === "PRAGMA foreign_keys = ON") return;
        if (sql === "BEGIN IMMEDIATE") assert.equal(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1, "FK включены до BEGIN на этом handle");
        db.exec(sql);
      },
      async closeAsync() { closed += 1; db.close(); },
    };
  };
  return { open, events, get handles() { return handles; }, get closed() { return closed; },
    failForeignKeys: () => { ignoreForeignKeys = true; } };
}

test("SQLite runtime: каждый новый handle проверяет FK до BEGIN; ошибка откатывает всё, очередь продолжает работу", async () => {
  const directory = mkdtempSync(join(tmpdir(), "athlete-db-connection-"));
  const native = nativeFactory(join(directory, "synthetic.db"));
  const connection = await openIsolatedSqliteConnection(native.open);
  const writer = new WriterCoordinator(connection);
  try {
    await writer.write(async (tx) => {
      await tx.run("CREATE TABLE parent (id TEXT PRIMARY KEY)");
      await tx.run("CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id))");
    });
    await assert.rejects(writer.write(async (tx) => {
      await tx.run("INSERT INTO parent VALUES ('rolled-back')");
      assert.equal((await connection.first<{ n: number }>("SELECT count(*) AS n FROM parent"))?.n, 0, "reader не видит незавершённую запись другого handle");
      await tx.run("INSERT INTO child VALUES ('invalid','missing')");
    }), /FOREIGN KEY/);
    assert.equal((await connection.first<{ n: number }>("SELECT count(*) AS n FROM parent"))?.n, 0);
    await writer.write(async (tx) => {
      await tx.run("INSERT INTO parent VALUES ('valid')");
      await tx.run("INSERT INTO child VALUES ('valid','valid')");
    });
    assert.equal((await connection.first<{ n: number }>("SELECT count(*) AS n FROM child"))?.n, 1);
    assert.equal(native.handles, 4);
    assert.equal(native.closed, 3);
    assert.equal(new Set(native.events.filter((event) => event.sql === "BEGIN IMMEDIATE").map((event) => event.handle)).size, 3);
    assert.ok(native.events.some((event) => event.sql === "ROLLBACK"));
    assert.equal((await connection.first<{ journal_mode: string }>("PRAGMA journal_mode"))?.journal_mode, "wal");
  } finally { await connection.close(); rmSync(directory, { recursive: true, force: true }); }
  assert.equal(native.closed, native.handles);
});

test("SQLite runtime: если новый handle не включает FK, пользовательская команда даже не начинается", async () => {
  const directory = mkdtempSync(join(tmpdir(), "athlete-db-fk-failure-"));
  const native = nativeFactory(join(directory, "synthetic.db"));
  const connection = await openIsolatedSqliteConnection(native.open);
  let invoked = false;
  try {
    native.failForeignKeys();
    await assert.rejects(connection.exclusive(async () => { invoked = true; }), /DB_FOREIGN_KEYS_UNAVAILABLE/);
    assert.equal(invoked, false);
    assert.equal(native.closed, 1);
    assert.ok(!native.events.some((event) => event.sql === "BEGIN IMMEDIATE"));
  } finally { await connection.close(); rmSync(directory, { recursive: true, force: true }); }
});
