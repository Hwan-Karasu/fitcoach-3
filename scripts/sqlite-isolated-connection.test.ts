import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openIsolatedSqliteConnection, type NativeSqliteDatabase } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { SqliteOpenCloseError } from "../apps/mobile/src/shared/db/SqlitePort.ts";
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

test("SQLite runtime: handle записи проверяет FK до первого BEGIN и переиспользуется; ошибка откатывает всё, очередь продолжает работу", async () => {
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
    // WRITE-PATH-1: reader + один handle записи на все три транзакции (раньше — новый handle и 4 PRAGMA на каждую запись).
    assert.equal(native.handles, 2);
    assert.equal(native.closed, 0, "handle записи живёт до закрытия соединения");
    assert.equal(new Set(native.events.filter((event) => event.sql === "BEGIN IMMEDIATE").map((event) => event.handle)).size, 1);
    assert.equal(native.events.filter((event) => event.sql === "PRAGMA foreign_keys = ON").length, 2, "FK включаются один раз на handle");
    assert.ok(native.events.some((event) => event.sql === "ROLLBACK"));
    assert.equal((await connection.first<{ journal_mode: string }>("PRAGMA journal_mode"))?.journal_mode, "wal");
  } finally { await connection.close(); rmSync(directory, { recursive: true, force: true }); }
  assert.equal(native.closed, native.handles);
});

test("WRITE-PATH-1: сбой закрытия handle записи не глушится — release/restore откажет, reader всё равно закрыт", async () => {
  const directory = mkdtempSync(join(tmpdir(), "athlete-db-close-"));
  const native = nativeFactory(join(directory, "synthetic.db"));
  let opened = 0;
  const connection = await openIsolatedSqliteConnection(async () => {
    const handle = await native.open();
    opened += 1;
    return opened === 2 ? { ...handle, closeAsync: async () => { await handle.closeAsync(); throw new Error("CLOSE_FAILED"); } } : handle;
  });
  try {
    await connection.exclusive(async (tx) => { await tx.run("CREATE TABLE t (id INTEGER)"); });
    await assert.rejects(connection.close(), /CLOSE_FAILED/);
    assert.equal(native.closed, 2, "reader закрыт и при сбое handle записи");
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
    assert.equal(native.closed, 1, "ненастроенный handle закрыт и не переиспользуется");
    assert.ok(!native.events.some((event) => event.sql === "BEGIN IMMEDIATE"));
    await assert.rejects(connection.exclusive(async () => { invoked = true; }), /DB_FOREIGN_KEYS_UNAVAILABLE/);
    assert.equal(native.handles, 3, "следующая запись снова открывает и проверяет новый handle");
    assert.equal(invoked, false);
  } finally { await connection.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("AUDIT-ALL-1: failed rollback/close сохраняет handle, блокирует запись и maintenance; повторное закрытие освобождает его", async () => {
  const directory = mkdtempSync(join(tmpdir(), "athlete-db-unclosed-writer-"));
  const native = nativeFactory(join(directory, "synthetic.db"));
  let opened = 0; let refuseClose = true;
  const connection = await openIsolatedSqliteConnection(async () => {
    const handle = await native.open();
    if (++opened !== 2) return handle;
    return { ...handle,
      execAsync: async (sql) => { if (sql === "ROLLBACK") throw new Error("ROLLBACK_FAILED"); await handle.execAsync(sql); },
      closeAsync: async () => { if (refuseClose) throw new Error("CLOSE_FAILED"); await handle.closeAsync(); },
    };
  });
  const shared = new SharedSqliteDatabase(async () => connection);
  const lease = await shared.acquire();
  try {
    await assert.rejects(lease.writer.write(async (tx) => {
      await tx.run("CREATE TABLE never_committed (id INTEGER)");
      throw new Error("ORIGINAL_WRITE_FAILED");
    }), /ORIGINAL_WRITE_FAILED/, "cleanup не подменяет исходную ошибку команды");
    await assert.rejects(lease.writer.write(async () => undefined), /DB_WRITER_UNAVAILABLE/);
    assert.equal(native.handles, 2, "новый handle не открывается поверх потерянного writer");
    let swapped = false;
    await assert.rejects(shared.withClosedDatabase(() => shared.release(), async () => { swapped = true; }), /DATABASE_CLOSE_FAILED/);
    assert.equal(swapped, false, "замена файла запрещена, пока native writer не закрыт");
    assert.equal(native.closed, 1, "reader освобождён даже при ошибке writer.close");
    refuseClose = false;
    await connection.close();
    await connection.close();
    assert.equal(native.closed, 2, "повторная очистка закрывает сохранённый writer, а закрытый reader не закрывает дважды");
  } finally { refuseClose = false; await connection.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("AUDIT-ALL-1: после failed rollback и успешного закрытия writer следующая команда использует новый проверенный handle", async () => {
  const directory = mkdtempSync(join(tmpdir(), "athlete-db-discard-writer-"));
  const native = nativeFactory(join(directory, "synthetic.db"));
  let opened = 0;
  const connection = await openIsolatedSqliteConnection(async () => {
    const handle = await native.open();
    return ++opened === 2 ? { ...handle, execAsync: async (sql) => {
      if (sql === "ROLLBACK") throw new Error("ROLLBACK_FAILED"); await handle.execAsync(sql);
    } } : handle;
  });
  const writer = new WriterCoordinator(connection);
  try {
    await assert.rejects(writer.write(async () => { throw new Error("WRITE_FAILED"); }), /WRITE_FAILED/);
    await writer.write((tx) => tx.run("CREATE TABLE recovered (id INTEGER)"));
    assert.equal(native.handles, 3);
    assert.equal(native.closed, 1);
  } finally { await connection.close(); rmSync(directory, { recursive: true, force: true }); }
  assert.equal(native.closed, native.handles);
});

test("AUDIT-ALL-1: failed initial reader close блокирует новый open и file task до успешной повторной очистки", async () => {
  const directory = mkdtempSync(join(tmpdir(), "athlete-db-open-close-"));
  const native = nativeFactory(join(directory, "synthetic.db"));
  let opened = 0; let refuseClose = true;
  const shared = new SharedSqliteDatabase(() => openIsolatedSqliteConnection(async () => {
    const handle = await native.open();
    return ++opened === 1 ? { ...handle,
      execAsync: async () => { throw new Error("ORIGINAL_SETUP_FAILED"); },
      closeAsync: async () => { if (refuseClose) throw new Error("READER_CLOSE_FAILED"); await handle.closeAsync(); },
    } : handle;
  }));
  try {
    await assert.rejects(shared.acquire(), (error: unknown) => {
      assert.ok(error instanceof SqliteOpenCloseError);
      assert.equal((error.cause as Error).message, "ORIGINAL_SETUP_FAILED");
      assert.equal((error.closeError as Error).message, "READER_CLOSE_FAILED");
      return true;
    });
    await assert.rejects(shared.acquire(), /DATABASE_CLOSE_FAILED/);
    assert.equal(native.handles, 1, "повтор acquire сначала закрывает исходный native reader");
    let swapped = false;
    await assert.rejects(shared.withClosedDatabase(async () => undefined, async () => { swapped = true; }), /DATABASE_CLOSE_FAILED/);
    assert.equal(swapped, false);
    refuseClose = false;
    await shared.withClosedDatabase(async () => undefined, async () => {
      assert.equal(native.closed, 1, "cleanup завершился до разрешения файловой операции"); swapped = true;
    });
    assert.equal(swapped, true);
    await shared.acquire();
    assert.equal(native.handles, 2);
    await shared.release();
    assert.equal(native.closed, native.handles);
  } finally { refuseClose = false; await shared.release(); rmSync(directory, { recursive: true, force: true }); }
});
