import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BootCoordinator } from "../apps/mobile/src/app/bootstrap/BootCoordinator.ts";
import { createDevBootDependencies } from "../apps/mobile/src/app/bootstrap/DevBootDependencies.ts";
import { DEV_SCHEMA_OWNERS, prepareDevSchema } from "../apps/mobile/src/app/composition/devSchema.ts";
import { importLegacyDevDatabase, LEGACY_DEV_DATABASE } from "../apps/mobile/src/app/composition/legacyDevImport.ts";
import { DevAccountingRepository } from "../apps/mobile/src/features/accounting/data/DevAccountingRepository.ts";
import { DevCalendarRepository } from "../apps/mobile/src/features/calendar/data/DevCalendarRepository.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository } from "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import { DevNotificationRepository } from "../apps/mobile/src/features/notifications/data/DevNotificationRepository.ts";
import { DevSettingsRepository } from "../apps/mobile/src/features/settings/data/DevSettingsRepository.ts";
import { DevFoodCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevFoodCatalogRepository.ts";
import { DevRecipeCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevRecipeCatalogRepository.ts";
import { DevNutritionDiaryRepository } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { snapshotOfRecipe } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { DevQuestionnaireRepository } from "../apps/mobile/src/features/questionnaire/data/DevQuestionnaireRepository.ts";
import { DevTrainingPlansRepository } from "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { newDraft, setTitle, addExercise, fillSets } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import { importLegacyDevData } from "../apps/mobile/src/shared/db/LegacyDevImport.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 9, 22, 12, 0);

/** Прежний dev-файл: схема текущей цепочки с данными, затем все таблицы данных получают прежний префикс `dev_`. */
async function legacyDatabase(file = ":memory:"): Promise<DatabaseSync> {
  const db = new DatabaseSync(file);
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  await prepareDevSchema(shared);
  const calendar = new DevCalendarRepository(shared, WS);
  await calendar.initialize();
  const accounting = new DevAccountingRepository(shared, WS);
  await accounting.initialize();
  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  const settings = new DevSettingsRepository(shared, WS);
  await settings.initialize();
  const notifications = new DevNotificationRepository(shared, WS);
  await notifications.initialize();
  const anna = await clients.create({ displayName: "SyntheticAnna" });
  await clients.create({ displayName: "SyntheticBoris" });
  await accounting.setClientMode(anna.id, "FITCOACH");
  await accounting.createPack(anna.id, { title: "Пакет 5", creditScope: "GENERAL", sessionTypeId: null, sessionTypeName: null, grantedCount: 5,
    totalKopeks: 850_000, expiresOn: null });
  await accounting.writeOff(anna.id);
  const type = (await calendar.listSessionTypes()).find((item) => !item.requiresCredit)!;
  await calendar.createAppointment({ localDate: "2026-10-23", startMinute: 600, durationMinutes: 60, clientId: anna.id, guestName: null, sessionTypeId: type.id, note: null });
  await measurements.record(anna.id, { type: "WEIGHT", valueX10: 801, localDate: "2026-10-20", localMinute: null }, NOW);
  await settings.saveAppearance({ themeId: "noir", accentId: null });
  await notifications.materialize([{ sourceType: "APPOINTMENT", sourceId: "a1", eventKind: "REMINDER", eventVersion: "v1", clientId: anna.id, title: "Запись", body: "тест",
    occursAt: new Date(NOW.getTime() - 60_000).toISOString() }], NOW);
  const foods = new DevFoodCatalogRepository(shared, WS);
  const recipes = new DevRecipeCatalogRepository(shared, WS);
  const diary = new DevNutritionDiaryRepository(shared, WS);
  await foods.initialize(); await recipes.initialize(); await diary.initialize();
  const food = await foods.create({ name: "Synthetic Oats", brand: null, unit: "G", amountX10: 1000,
    kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 }, NOW);
  const recipe = await recipes.create({ name: "Synthetic Porridge", servingsX10: 10, cookedMassX10: null,
    ingredients: [{ foodId: food.id, quantityX10: 500 }] }, NOW);
  const snapshot = snapshotOfRecipe(recipe, "PORTION", 10);
  await diary.addEntry(anna.id, { localDate: "2026-10-20", slot: "BREAKFAST", snapshot }, NOW);
  await diary.createSavedMeal(anna.id, { name: "Synthetic Breakfast", snapshots: [snapshot] });
  const questionnaire = new DevQuestionnaireRepository(shared, WS);
  await questionnaire.initialize();
  await questionnaire.saveAnswers(anna.id, { "sys:lifestyle.sleep": "7 часов", "sys:health.noContra": false });
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const draft = fillSets(addExercise(setTitle(newDraft("synthetic-w1"), "Synthetic Plan"),
    "synthetic-w1", "synthetic-e1", "sys:repdb:synthetic-bench", (i) => `synthetic-s${i}`), "synthetic-e1", "reps", 10);
  const program = await plans.createSimpleProgram(anna.id, draft);
  await plans.saveSimpleWorkout(anna.id, program.id, program.revision, { weekIndex: 2, workoutId: "synthetic-w1",
    workout: { ...draft.plan.workouts[0]!, title: "Synthetic Override" }, scope: "CURRENT" });
  // Репозитории не закрываем: закрытие закрыло бы саму базу, а она нужна как источник переноса.
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%schema_migrations'`).all() as { name: string }[];
  for (const { name } of tables) db.exec(`ALTER TABLE ${name} RENAME TO dev_${name}`);
  return db;
}

async function freshTarget(): Promise<Readonly<{ db: DatabaseSync; target: Parameters<typeof importLegacyDevData>[0] }>> {
  const db = new DatabaseSync(":memory:");
  const port = nodeSqlitePort(db);
  for (const owner of DEV_SCHEMA_OWNERS) await runMigrations(new WriterCoordinator(port), owner.chain, owner.ledger);
  return { db, target: { writer: new WriterCoordinator(port), reader: port } };
}

const counts = (db: DatabaseSync, prefix: string): Readonly<Record<string, number>> => {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '${prefix}%' AND name NOT LIKE '%schema_migrations' AND name NOT LIKE '%marker' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name.slice(prefix.length), (db.prepare(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n]));
};

test("D01 перенос из прежнего dev-файла: все строки, порядок по внешним ключам, одна транзакция, повтор не выполняется", async () => {
  const legacy = await legacyDatabase();
  const { db, target } = await freshTarget();
  const result = await importLegacyDevData(target, nodeSqlitePort(legacy));
  assert.equal(result.status, "IMPORTED");
  const before = counts(legacy, "dev_");
  const after = counts(db, "");
  assert.equal(result.tables, 64);
  for (const [table, rows] of Object.entries(before)) assert.equal(after[table], rows, `таблица ${table}`);
  const contents = (database: DatabaseSync, table: string) => database.prepare(`SELECT * FROM ${table}`).all()
    .map((row) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))).sort();
  for (const table of Object.keys(before)) {
    assert.deepEqual(contents(db, table), contents(legacy, `dev_${table}`), `все значения ${table}`);
  }
  assert.ok((after.clients ?? 0) === 2 && (after.session_packs ?? 0) === 1 && (after.body_measurements ?? 0) === 1 && (after.notification_events ?? 0) === 1);
  assert.equal(result.rows, Object.values(before).reduce((sum, rows) => sum + rows, 0));
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal((db.prepare("SELECT display_name AS name FROM clients ORDER BY display_name").all() as { name: string }[]).map((row) => row.name).join(","), "SyntheticAnna,SyntheticBoris");
  assert.deepEqual({ ...await importLegacyDevData(target, nodeSqlitePort(legacy)) }, { status: "SKIPPED_ALREADY_DONE", tables: 0, rows: 0 });
});

test("D01 перенос не затирает уже используемую новую базу и не ставит отметку успеха", async () => {
  const legacy = await legacyDatabase();
  const { db, target } = await freshTarget();
  db.prepare("INSERT INTO workspaces (id, display_name, created_at) VALUES ('w', 'Synthetic', 'now')").run();
  await assert.rejects(importLegacyDevData(target, nodeSqlitePort(legacy)), { message: "LEGACY_IMPORT_TARGET_NOT_EMPTY" });
  assert.equal(counts(db, "").clients, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM dev_legacy_import").get()?.n, 0);
  await assert.rejects(importLegacyDevData(target, nodeSqlitePort(legacy)), { message: "LEGACY_IMPORT_TARGET_NOT_EMPTY" });
});

test("D01 нет прежнего файла с данными — ничего не переносится; ошибка переноса откатывает всё и метка не ставится", async () => {
  const empty = new DatabaseSync(":memory:");
  const first = await freshTarget();
  assert.equal((await importLegacyDevData(first.target, nodeSqlitePort(empty))).status, "SKIPPED_NO_LEGACY");

  const legacy = await legacyDatabase();
  // Осиротевшая запись (пакет без клиента) — перенос должен заметить это проверкой внешних ключей и откатиться целиком.
  legacy.exec("PRAGMA foreign_keys = OFF");
  legacy.exec("DELETE FROM dev_clients WHERE display_name = 'SyntheticAnna'");
  legacy.exec("PRAGMA foreign_keys = ON");
  const second = await freshTarget();
  await assert.rejects(importLegacyDevData(second.target, nodeSqlitePort(legacy)));
  assert.equal(Object.values(counts(second.db, "")).reduce((sum, rows) => sum + rows, 0), 0, "частичного переноса нет");
  assert.equal((second.db.prepare("SELECT count(*) AS n FROM dev_legacy_import").get() as { n: number }).n, 0, "метки нет — перенос повторится");
});

test("D01 порядок запуска «схема → перенос → обычная инициализация»: данные целы, засев репозиториев ничего не дублирует", async () => {
  const legacy = await legacyDatabase();
  const legacyTypes = (legacy.prepare("SELECT count(*) AS n FROM dev_session_types").get() as { n: number }).n;
  const { db, target } = await freshTarget();
  assert.equal((await importLegacyDevData(target, nodeSqlitePort(legacy))).status, "IMPORTED");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const calendar = new DevCalendarRepository(shared, WS);
  await calendar.initialize();
  const accounting = new DevAccountingRepository(shared, WS);
  await accounting.initialize();
  try {
    assert.equal((await clients.list("ACTIVE")).length, 2);
    assert.equal((await calendar.listSessionTypes()).length, legacyTypes, "типы занятий не задвоились");
    const anna = (await clients.list("ACTIVE")).find((row) => row.displayName === "SyntheticAnna")!;
    const snapshot = await accounting.getClientSnapshot(anna.id);
    assert.deepEqual([snapshot.packs.length, snapshot.available], [1, 4], "пакет и ручное списание перенесены");
    assert.equal((await calendar.listRange("2026-10-23", "2026-10-23")).appointments.length, 1);
  } finally { await accounting.close(); await calendar.close(); await clients.close(); }
});

test("D01 сбой чтения при boot: засев не начинается, файлы закрываются, повтор сохраняет все данные", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fitcoach-d01-retry-"));
  const legacyFile = join(directory, LEGACY_DEV_DATABASE);
  const targetFile = join(directory, "synthetic-target.db");
  const legacy = await legacyDatabase(legacyFile);
  const before = counts(legacy, "dev_");
  legacy.close();
  const database = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(targetFile)));
  const clients = new DevClientRepository(database, WS, []);
  const calendar = new DevCalendarRepository(database, WS);
  let fail = true;
  let sourceClosed = 0;
  let seeds = 0;
  const boot = new BootCoordinator(createDevBootDependencies(
    async () => nodeSqlitePort(new DatabaseSync(":memory:")),
    async () => {
      await prepareDevSchema(database);
      await importLegacyDevDatabase(database, async (name) => {
        assert.equal(name, LEGACY_DEV_DATABASE);
        const source = nodeSqlitePort(new DatabaseSync(legacyFile));
        return {
          ...source,
          async all<Row>(sql: string, bindings?: Parameters<typeof source.all>[1]): Promise<readonly Row[]> {
            // Fail after earlier table inserts, so the test also proves rollback of partial copying.
            if (fail && sql === "SELECT * FROM dev_clients") throw new Error("SYNTHETIC_READ_FAILURE");
            return source.all<Row>(sql, bindings);
          },
          async close() { sourceClosed += 1; await source.close(); },
        };
      });
      seeds += 1;
      await clients.initialize();
      await calendar.initialize();
    },
  ));
  try {
    assert.deepEqual(await boot.start(), { kind: "BOOT_FAILED", attempt: 1, code: "MIGRATION_INCOMPLETE" });
    assert.equal(seeds, 0, "после ошибки нельзя заполнять новую базу");
    assert.equal(sourceClosed, 1);
    const failed = new DatabaseSync(targetFile);
    try {
      assert.equal(Object.values(counts(failed, "")).reduce((sum, rows) => sum + rows, 0), 0);
      assert.equal(failed.prepare("SELECT count(*) AS n FROM dev_legacy_import").get()?.n, 0);
    } finally { failed.close(); }
    fail = false;
    assert.equal((await boot.retry()).kind, "APP_READY");
    assert.equal(seeds, 1);
    assert.equal(sourceClosed, 2);
    assert.equal((await clients.list("ACTIVE")).length, 2);
    const lease = await database.acquire();
    try {
      for (const [table, n] of Object.entries(before)) {
        assert.equal((await lease.connection.first<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))?.n, n, table);
      }
      assert.equal((await lease.connection.first<{ status: string }>("SELECT status FROM dev_legacy_import"))?.status, "IMPORTED");
      for (const owner of DEV_SCHEMA_OWNERS) {
        const rows = await lease.connection.all<{ version: number; checksum: string }>(`SELECT version, checksum FROM ${owner.ledger}`);
        assert.deepEqual(rows.map((row) => ({ ...row })), owner.chain.map(({ version, checksum }) => ({ version, checksum })), owner.owner);
      }
    } finally { await database.release(); }
    const unchanged = new DatabaseSync(legacyFile);
    try { assert.deepEqual(counts(unchanged, "dev_"), before); }
    finally { unchanged.close(); }
  } finally {
    await calendar.close();
    await clients.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D01 неизвестные таблицы и отличающиеся колонки источника не теряются молча", async () => {
  const legacy = await legacyDatabase();
  legacy.exec("CREATE TABLE dev_unknown_data (id TEXT PRIMARY KEY); INSERT INTO dev_unknown_data VALUES ('synthetic')");
  const { db, target } = await freshTarget();
  await assert.rejects(importLegacyDevData(target, nodeSqlitePort(legacy)), { message: "LEGACY_IMPORT_UNKNOWN_TABLE" });
  legacy.exec("DROP TABLE dev_unknown_data; ALTER TABLE dev_clients ADD COLUMN unexpected TEXT");
  await assert.rejects(importLegacyDevData(target, nodeSqlitePort(legacy)), { message: "LEGACY_IMPORT_SCHEMA_MISMATCH:clients" });
  assert.equal(db.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM dev_legacy_import").get()?.n, 0);
  db.close();
  legacy.close();
});

test("D01 источник закрывается даже при отказе открытия новой базы", async () => {
  let closed = 0;
  const source = nodeSqlitePort(new DatabaseSync(":memory:"));
  const database = new SharedSqliteDatabase(async () => { throw new Error("SYNTHETIC_OPEN_FAILURE"); });
  await assert.rejects(importLegacyDevDatabase(database, async () => ({
    ...source, async close() { closed += 1; await source.close(); },
  })), { message: "SYNTHETIC_OPEN_FAILURE" });
  assert.equal(closed, 1);
});

test("D01 перенос проверяет содержимое строк до отметки успеха; искажение откатывается, повтор сохраняет исходник", async () => {
  const legacy = await legacyDatabase();
  const { db, target } = await freshTarget();
  db.exec(`CREATE TRIGGER synthetic_corruption AFTER INSERT ON clients BEGIN
    UPDATE clients SET display_name='Corrupted' WHERE id=NEW.id; END`);
  try {
    await assert.rejects(importLegacyDevData(target, nodeSqlitePort(legacy)), { message: "LEGACY_IMPORT_PARITY_FAILED" });
    assert.equal(db.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM dev_legacy_import").get()?.n, 0);
    assert.equal(legacy.prepare("SELECT count(*) AS n FROM dev_clients WHERE display_name='SyntheticAnna'").get()?.n, 1);
    db.exec("DROP TRIGGER synthetic_corruption");
    assert.equal((await importLegacyDevData(target, nodeSqlitePort(legacy))).status, "IMPORTED");
    assert.equal(db.prepare("SELECT count(*) AS n FROM clients WHERE display_name='SyntheticAnna'").get()?.n, 1);
  } finally { db.close(); legacy.close(); }
});

test("D01 dev-перенос не округляет небезопасное целое число из исходной SQLite", async () => {
  const legacy = await legacyDatabase();
  const { db, target } = await freshTarget();
  legacy.exec("UPDATE dev_clients SET height_cm_x10=9007199254740993 WHERE display_name='SyntheticAnna'");
  try {
    // Expo's native boundary returns JS numbers; Node normally rejects int64 overflow
    // before our guard sees it. Model that external numeric conversion explicitly.
    const nativeNumbers = { ...nodeSqlitePort(legacy), all: async <Row>(sql: string): Promise<readonly Row[]> => {
      const statement = legacy.prepare(sql); statement.setReadBigInts(true);
      return statement.all().map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, typeof value === "bigint" ? Number(value) : value]))) as Row[];
    } };
    await assert.rejects(importLegacyDevData(target, nativeNumbers), { message: "LEGACY_IMPORT_VALUE_UNSUPPORTED" });
    assert.equal(db.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM dev_legacy_import").get()?.n, 0);
    assert.equal(legacy.prepare("SELECT CAST(height_cm_x10 AS TEXT) AS exact FROM dev_clients WHERE display_name='SyntheticAnna'").get()?.exact, "9007199254740993");
  } finally { db.close(); legacy.close(); }
});
