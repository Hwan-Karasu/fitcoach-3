import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BootCoordinator } from "../apps/mobile/src/app/bootstrap/BootCoordinator.ts";
import { createDevBootDependencies } from "../apps/mobile/src/app/bootstrap/DevBootDependencies.ts";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from
  "../apps/mobile/src/shared/db/SqlitePort.ts";

function memoryPort(db: DatabaseSync, onClose: () => void): SqliteConnectionPort {
  const statements: SqliteStatementPort = {
    run: async (sql: string, bindings: readonly SqlValue[] = []) => {
      const result = db.prepare(sql).run(...bindings);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    first: async <Row>(sql: string, bindings: readonly SqlValue[] = []): Promise<Row | null> =>
      (db.prepare(sql).get(...bindings) as Row | undefined) ?? null,
    all: async <Row>(sql: string, bindings: readonly SqlValue[] = []): Promise<readonly Row[]> =>
      db.prepare(sql).all(...bindings) as Row[],
  };
  return {
    ...statements,
    exclusive: async <T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> => {
      db.exec("BEGIN IMMEDIATE");
      try { const value = await task(statements); db.exec("COMMIT"); return value; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    close: async () => { onClose(); },
  };
}

test("F03 dev gate applies only synthetic schema before showing the prototype shell", async () => {
  const db = new DatabaseSync(":memory:");
  let closes = 0;
  try {
    const gate = new BootCoordinator(createDevBootDependencies(async () => memoryPort(db, () => { closes += 1; })));
    const states: string[] = [];
    gate.subscribe((state) => { states.push(state.kind); });
    const ready = await gate.start();
    assert.equal(ready.kind, "APP_READY");
    if (ready.kind !== "APP_READY") return;
    assert.equal(ready.workspaceId, "synthetic-dev-workspace");
    assert.equal(ready.palette.themeId, "polar-teal");
    assert.deepEqual(states, ["BOOT_PENDING", "BOOT_PENDING", "DB_READY", "APP_READY"]);
    assert.equal(closes, 1);
    assert.equal((db.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='dev_boot_marker'").get() as { count: number }).count, 1);
  } finally { db.close(); }
});

test("F03 dev gate refuses mismatched migration history without deleting the source", async () => {
  const db = new DatabaseSync(":memory:");
  let closes = 0;
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)");
  db.exec("INSERT INTO schema_migrations VALUES (1, 'synthetic-wrong-checksum')");
  try {
    const gate = new BootCoordinator(createDevBootDependencies(async () => memoryPort(db, () => { closes += 1; })));
    assert.deepEqual(await gate.start(), { kind: "BOOT_FAILED", attempt: 1, code: "MIGRATION_INCOMPLETE" });
    assert.equal(closes, 1);
    assert.equal((db.prepare("SELECT checksum FROM schema_migrations WHERE version=1").get() as { checksum: string }).checksum,
      "synthetic-wrong-checksum");
    assert.equal((db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='dev_boot_marker'").get() as { count: number }).count, 0);
  } finally { db.close(); }
});

test("F03 dev gate reports unavailable database and retry succeeds without reset", async () => {
  const db = new DatabaseSync(":memory:");
  let opens = 0;
  try {
    const gate = new BootCoordinator(createDevBootDependencies(async () => {
      opens += 1;
      if (opens === 1) throw new Error("private native failure detail");
      return memoryPort(db, () => {});
    }));
    assert.deepEqual(await gate.start(), { kind: "BOOT_FAILED", attempt: 1, code: "DB_UNAVAILABLE" });
    const ready = await gate.retry();
    assert.equal(ready.kind, "APP_READY");
    assert.equal(opens, 2);
  } finally { db.close(); }
});

test("F03 dev gate reopens an existing synthetic SQLite file without replaying its migration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fitcoach-f03-reopen-"));
  const filename = join(directory, "synthetic-dev.db");
  let closes = 0;
  const open = async () => {
    const db = new DatabaseSync(filename);
    return memoryPort(db, () => { closes += 1; db.close(); });
  };
  try {
    const first = await new BootCoordinator(createDevBootDependencies(open)).start();
    assert.equal(first.kind, "APP_READY");
    const second = await new BootCoordinator(createDevBootDependencies(open)).start();
    assert.equal(second.kind, "APP_READY");
    assert.equal(closes, 2);
    const verify = new DatabaseSync(filename);
    try {
      assert.equal((verify.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: number }).count, 1);
      assert.equal((verify.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='dev_boot_marker'").get() as { count: number }).count, 1);
    } finally { verify.close(); }
  } finally {
    rmSync(filename, { force: true });
    rmdirSync(directory);
  }
});

test("F03 dev gate refuses a missing marker despite valid migration history", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const dependencies = createDevBootDependencies(async () => memoryPort(db, () => {}));
    assert.equal((await new BootCoordinator(dependencies).start()).kind, "APP_READY");
    db.exec("DROP TABLE dev_boot_marker");
    assert.deepEqual(await new BootCoordinator(dependencies).start(),
      { kind: "BOOT_FAILED", attempt: 1, code: "MIGRATION_INCOMPLETE" });
    assert.equal((db.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: number }).count, 1);
  } finally { db.close(); }
});

test("F04 client store must initialize before APP_READY and retry remains possible", async () => {
  const db = new DatabaseSync(":memory:");
  let attempts = 0;
  try {
    const dependencies = createDevBootDependencies(
      async () => memoryPort(db, () => {}),
      async () => { attempts += 1; if (attempts === 1) throw new Error("synthetic client store failure"); },
    );
    const gate = new BootCoordinator(dependencies);
    assert.deepEqual(await gate.start(),
      { kind: "BOOT_FAILED", attempt: 1, code: "MIGRATION_INCOMPLETE" });
    assert.equal((await gate.retry()).kind, "APP_READY");
    assert.equal(attempts, 2);
  } finally { db.close(); }
});
