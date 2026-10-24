import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BootCoordinator } from "../apps/mobile/src/app/bootstrap/BootCoordinator.ts";
import { createProductionBootDependencies } from "../apps/mobile/src/app/bootstrap/ProductionBootDependencies.ts";
import { PRODUCTION_DATABASE, PRODUCTION_IDENTITY, PRODUCTION_WORKSPACE_ID, inspectProductionDatabase, prepareProductionDatabase }
  from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../apps/mobile/src/app/composition/schema.ts";
import { DATABASE_IDENTITY_TABLE, DatabaseCompatibilityError } from "../apps/mobile/src/shared/db/DatabaseIdentity.ts";
import { runMigrationsInTransaction } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { openIsolatedSqliteConnection } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevCalendarRepository } from "../apps/mobile/src/features/calendar/data/DevCalendarRepository.ts";
import { DevSettingsRepository } from "../apps/mobile/src/features/settings/data/DevSettingsRepository.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { nativeSqliteDatabase } from "./support/native-sqlite-database.ts";
import type { SqlValue } from "../apps/mobile/src/shared/db/SqlitePort.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "athlete-production-"));
  const file = join(directory, PRODUCTION_DATABASE);
  const opened: string[] = [];
  const commands: string[] = [];
  let failOn = "";
  const database = new SharedSqliteDatabase(() => openIsolatedSqliteConnection(async () => {
    opened.push(file);
    const native = nativeSqliteDatabase(file);
    return { ...native,
      async execAsync(sql) { commands.push(sql); await native.execAsync(sql); },
      async runAsync(sql: string, ...args: unknown[]) {
        if (failOn && sql.startsWith(failOn)) throw new Error("SYNTHETIC_CREATE_FAILURE");
        return native.runAsync(sql, ...args as SqlValue[]);
      },
    };
  }, inspectProductionDatabase));
  return { directory, file, database, opened, commands, fail: (prefix: string) => { failOn = prefix; },
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("D01-4 обычный boot: 64 таблицы без тестовых клиентов; dev-файл не открывается; повтор сохраняет клиента и тему", async () => {
  const f = fixture();
  const source = join(f.directory, "fitcoach_f04_clients_dev.db");
  const legacy = new DatabaseSync(source);
  legacy.exec("CREATE TABLE dev_clients (id TEXT, name TEXT); INSERT INTO dev_clients VALUES ('synthetic','Synthetic Old')");
  legacy.close();
  const original = readFileSync(source);
  const clients = new DevClientRepository(f.database, PRODUCTION_WORKSPACE_ID, []);
  const calendar = new DevCalendarRepository(f.database, PRODUCTION_WORKSPACE_ID);
  const settings = new DevSettingsRepository(f.database, PRODUCTION_WORKSPACE_ID);
  const initialize = async () => { await clients.initialize(); await calendar.initialize(); await settings.initialize(); };
  try {
    const boot = new BootCoordinator(createProductionBootDependencies(f.database, initialize, () => settings.readAppearance()));
    const state = await boot.start();
    assert.equal(state.kind, "APP_READY");
    if (state.kind !== "APP_READY") return;
    assert.equal(state.workspaceId, PRODUCTION_WORKSPACE_ID);
    assert.equal((await clients.list("ACTIVE")).length, 0);
    const lease = await f.database.acquire();
    try {
      assert.equal(await inspectProductionDatabase(lease.connection), "OWNED");
      assert.equal((await lease.connection.first<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))?.n, 76);
      assert.equal((await lease.connection.first<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'dev_%'"))?.n, 0);
    } finally { await f.database.release(); }
    const client = await clients.create({ displayName: "Synthetic Persisted" });
    await settings.saveAppearance({ themeId: "slate-blue", accentId: null });
    await settings.close(); await calendar.close(); await clients.close();
    const reopened = new BootCoordinator(createProductionBootDependencies(f.database, initialize, () => settings.readAppearance()));
    const ready = await reopened.start();
    assert.equal(ready.kind, "APP_READY");
    if (ready.kind === "APP_READY") assert.equal(ready.palette.themeId, "slate-blue");
    assert.equal((await clients.get(client.id))?.displayName, "Synthetic Persisted");
    assert.ok(f.opened.every((path) => path === f.file));
    assert.deepEqual(readFileSync(source), original, "старый dev-файл не меняется и не импортируется");
  } finally { await settings.close(); await calendar.close(); await clients.close(); f.cleanup(); }
});

test("D01-4 чужой файл без своего журнала отклоняется до WAL и засева; байты остаются прежними", async () => {
  const f = fixture();
  const foreign = new DatabaseSync(f.file);
  foreign.exec("CREATE TABLE clients (id TEXT, name TEXT); INSERT INTO clients VALUES ('synthetic','Foreign Source')");
  foreign.close();
  const before = readFileSync(f.file);
  let initialized = false;
  try {
    const boot = new BootCoordinator(createProductionBootDependencies(f.database, async () => { initialized = true; }, async () => null));
    assert.deepEqual(await boot.start(), { kind: "BOOT_FAILED", attempt: 1, code: "DATABASE_INCOMPATIBLE" });
    assert.equal(initialized, false);
    assert.ok(!f.commands.some((sql) => sql.includes("journal_mode = WAL") || sql.startsWith("BEGIN")));
    assert.deepEqual(readFileSync(f.file), before);
    assert.deepEqual(await boot.retry(), { kind: "BOOT_FAILED", attempt: 2, code: "DATABASE_INCOMPATIBLE" });
    assert.deepEqual(readFileSync(f.file), before);
  } finally { f.cleanup(); }
});

test("D01-4 новые форматы/версии, изменённые checksum и неполная схема отвергаются без записи", async () => {
  const cases = [
    ["UPDATE app_database_identity SET format_version = 2", "DATABASE_NEWER"],
    ["INSERT INTO clients_schema_migrations VALUES (3, 'future-version')", "DATABASE_NEWER"],
    ["UPDATE clients_schema_migrations SET checksum = 'unknown' WHERE version = 1", "DATABASE_INCOMPATIBLE"],
    ["DROP TABLE settings_schema_migrations", "DATABASE_INCOMPATIBLE"],
    ["DROP TABLE settings", "DATABASE_INCOMPATIBLE"],
    ["CREATE TABLE unknown_source (id TEXT)", "DATABASE_INCOMPATIBLE"],
    ["UPDATE app_database_identity SET product = 'foreign-product'", "DATABASE_INCOMPATIBLE"],
  ];
  for (const [sql, code] of cases) {
    const f = fixture();
    try {
      await prepareProductionDatabase(f.database);
      const editor = new DatabaseSync(f.file);
      editor.exec("PRAGMA journal_mode = DELETE"); editor.exec(sql!); editor.close();
      const before = readFileSync(f.file);
      f.commands.length = 0;
      await assert.rejects(prepareProductionDatabase(f.database), (error: unknown) => error instanceof DatabaseCompatibilityError && error.code === code, sql);
      assert.deepEqual(readFileSync(f.file), before, sql);
      assert.equal(f.commands.length, 0, sql);
    } finally { f.cleanup(); }
  }
});

test("D01-4 первая установка: сбой после первых владельцев откатывает также identity и application_id; Retry создаёт всё один раз", async () => {
  const f = fixture();
  let initialized = 0;
  const boot = new BootCoordinator(createProductionBootDependencies(f.database, async () => { initialized += 1; }, async () => null));
  try {
    f.fail("CREATE TABLE food_products");
    assert.deepEqual(await boot.start(), { kind: "BOOT_FAILED", attempt: 1, code: "MIGRATION_INCOMPLETE" });
    assert.equal(initialized, 0);
    const db = new DatabaseSync(f.file);
    try {
      assert.equal(await inspectProductionDatabase(nodeSqlitePort(db)), "NEW");
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()?.n, 0);
      assert.equal(db.prepare("PRAGMA application_id").get()?.application_id, 0);
    } finally { db.close(); }
    f.fail("");
    assert.equal((await boot.retry()).kind, "APP_READY");
    assert.equal(initialized, 1);
    await prepareProductionDatabase(f.database);
  } finally { f.cleanup(); }
});

test("D01-4 обновление своей baseline-базы: сбой JSON v2 откатывает все журналы и данные; после исправления синтетической фикстуры Retry проходит", async () => {
  const f = fixture();
  const db = new DatabaseSync(f.file);
  const port = nodeSqlitePort(db);
  try {
    await port.exclusive(async (tx) => {
      await tx.run(`CREATE TABLE ${DATABASE_IDENTITY_TABLE} (id INTEGER PRIMARY KEY, product TEXT, format_version INTEGER, workspace_id TEXT)`);
      await tx.run(`INSERT INTO ${DATABASE_IDENTITY_TABLE} VALUES (1, ?, ?, ?)`, [PRODUCTION_IDENTITY.product, PRODUCTION_IDENTITY.formatVersion, PRODUCTION_WORKSPACE_ID]);
      await tx.run(`PRAGMA application_id = ${PRODUCTION_IDENTITY.applicationId}`);
      for (const owner of SCHEMA_OWNERS) await runMigrationsInTransaction(tx, owner.chain.slice(0, 1), owner.ledger);
      await tx.run("INSERT INTO workspaces VALUES (?, 'Synthetic', 'x')", [PRODUCTION_WORKSPACE_ID]);
      await tx.run("INSERT INTO clients (id,workspace_id,display_name,lifecycle,revision,created_at,updated_at) VALUES ('synthetic',?,'Synthetic','ACTIVE',1,'x','x')", [PRODUCTION_WORKSPACE_ID]);
      await tx.run("INSERT INTO nutrition_batch_commands VALUES (?, 'synthetic', 'command', '{', '[]')", [PRODUCTION_WORKSPACE_ID]);
    });
  } finally { db.close(); }
  let initialized = false;
  const boot = new BootCoordinator(createProductionBootDependencies(f.database, async () => { initialized = true; }, async () => { throw new Error("SYNTHETIC_PREF_READ_FAILURE"); }));
  try {
    assert.deepEqual(await boot.start(), { kind: "BOOT_FAILED", attempt: 1, code: "MIGRATION_INCOMPLETE" });
    assert.equal(initialized, false);
    const reader = new DatabaseSync(f.file);
    try {
      for (const owner of SCHEMA_OWNERS) assert.equal(reader.prepare(`SELECT count(*) AS n FROM ${owner.ledger}`).get()?.n, 1, owner.owner);
      assert.equal(reader.prepare("SELECT display_name FROM clients").get()?.display_name, "Synthetic");
      assert.equal(reader.prepare("SELECT payload_json FROM nutrition_batch_commands").get()?.payload_json, "{");
      reader.exec("UPDATE nutrition_batch_commands SET payload_json = '[]'");
    } finally { reader.close(); }
    const ready = await boot.retry();
    assert.equal(ready.kind, "APP_READY");
    if (ready.kind === "APP_READY") assert.equal(ready.palette.themeId, "warm-sand", "сбой необязательных настроек не закрывает дневник");
    assert.equal(initialized, true);
  } finally { f.cleanup(); }
});
