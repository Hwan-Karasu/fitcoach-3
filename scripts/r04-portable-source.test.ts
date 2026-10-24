import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { NativeLegacySourceDatabase } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { readLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { readLegacyCalendarSnapshot } from "./r04/LegacyCalendarSnapshot.ts";
import { readLegacyMeasurementsSnapshotInSnapshot } from "./r04/LegacyMeasurementSourceReader.ts";
import { readLegacyNutritionInSnapshot } from "./r04/LegacyNutritionSourceReader.ts";

const accountScope = "portable-source-synthetic";
const time = "2026-10-24T12:00:00.000Z";
function seed(db: DatabaseSync) {
  db.exec(`CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT);
    CREATE TABLE client_measurements(id TEXT,client_id TEXT,date_key TEXT,neck TEXT,shoulders TEXT,chest TEXT,waist TEXT,hips TEXT,upper_arm TEXT,thigh TEXT,calf TEXT);
    CREATE TABLE nutrition_days(client_id TEXT,date_key TEXT,meals_json TEXT,water_ml INTEGER,updated_at TEXT);
    CREATE TABLE client_kbju_state(client_id TEXT,profile_json TEXT,manual_kbju_json TEXT,updated_at TEXT);
    CREATE TABLE food_products(id TEXT,name TEXT,brand TEXT,barcode TEXT,serving_mode TEXT,calories TEXT,protein TEXT,fat TEXT,carbs TEXT,favorite INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE nutrition_recipes(id TEXT,name TEXT,description TEXT,servings TEXT,items_json TEXT,calories TEXT,protein TEXT,fat TEXT,carbs TEXT,saved_to_cookbook INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE nutrition_archive_weeks(id TEXT,client_id TEXT,days_json TEXT);
    CREATE TABLE calendar_appointments(id TEXT,date_key TEXT,start_time TEXT,end_time TEXT,duration_minutes INTEGER,client_id TEXT,guest_name TEXT,client_name TEXT,appointment_type TEXT,note TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE app_settings(key TEXT,value,updated_at TEXT);
    INSERT INTO client_day_facts VALUES('a','2026-10-19','80.1','100','Да');
    INSERT INTO client_day_facts VALUES('b','2026-10-19','80.1',NULL,'Нет');
    INSERT INTO client_measurements VALUES('m','a','2026-10-19','40','','','80.1','','','','');
    INSERT INTO nutrition_days VALUES('a','2026-10-19','broken JSON retained verbatim',1000,'${time}');
    INSERT INTO client_kbju_state VALUES('a','{}','{"protein":1.00000000000000001}','${time}');
    INSERT INTO nutrition_archive_weeks VALUES('week','a','[{"weight":80.10000000000000001}]');
    INSERT INTO calendar_appointments VALUES('appointment','2026-10-19','09:00','10:00',60,'a','','Snapshot name','training',' Original note ','${time}','${time}',NULL);
    INSERT INTO app_settings VALUES('calendar_planner_settings','{"startHour":7,"endHour":22,"workingDays":[1]}','${time}');
    INSERT INTO app_settings VALUES('another-owner',9007199254740993,'${time}');`);
}

interface NativeFixture {
  readonly db: DatabaseSync;
  readonly native: NativeLegacySourceDatabase;
  readonly calls: string[];
  readonly closed: () => boolean;
}
function nativeFixture(db: DatabaseSync, before?: (sql: string) => void, after?: (sql: string) => void): NativeFixture {
  const calls: string[] = []; let closed = false;
  const native: NativeLegacySourceDatabase = {
    getAllAsync: async <Row>(sql: string, ...params: unknown[]): Promise<Row[]> => {
      calls.push(sql); before?.(sql);
      const bindings = (Array.isArray(params[0]) ? params[0] : params) as SQLInputValue[];
      const rows = db.prepare(sql).all(...bindings) as Row[];
      after?.(sql); return rows;
    },
    execAsync: async (sql) => { calls.push(sql); before?.(sql); db.exec(sql); after?.(sql); },
    closeAsync: async () => { calls.push("CLOSE"); db.close(); closed = true; },
  };
  return { db, native, calls, closed: () => closed };
}
function source() { const db = new DatabaseSync(":memory:"); seed(db); return db; }
function cleanup(dir: string) {
  const path = resolve(dir); assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith("athlete-r04-source-")); rmSync(path, { recursive: true, force: true });
}

test("mobile asynchronous and Node synchronous source reads retain identical full rows", async () => {
  const db = source();
  db.exec('ALTER TABLE nutrition_days ADD COLUMN "unknown""field" BLOB');
  db.prepare('UPDATE nutrition_days SET "unknown""field"=?').run(new Uint8Array([0, 255, 8]));
  const expected = { nutrition: readLegacyNutritionInSnapshot(db, accountScope), measurements: readLegacyMeasurementsSnapshotInSnapshot(db, accountScope), calendar: readLegacyCalendarSnapshot(db, accountScope) };
  const fixture = nativeFixture(db), actual = await readLegacyDomainSnapshots(async () => fixture.native, accountScope);
  assert.deepEqual(actual, expected); assert.equal(fixture.closed(), true);
  assert.deepEqual(actual.nutrition.tables.nutrition_days![0]!.meals_json, "broken JSON retained verbatim");
  assert.deepEqual(actual.measurements.clientDays, actual.nutrition.tables.client_day_facts);
  assert.equal(actual.calendar.plannerRows!.length, 1);
  assert.equal(actual.nutrition.tables.food_products!.length, 0);
  assert.deepEqual(fixture.calls.slice(-2), ["ROLLBACK", "CLOSE"]);
  assert.equal(fixture.calls.some((sql) => /(?:CREATE|INSERT|UPDATE|DELETE|journal_mode)/u.test(sql)), false);
});

test("optional source absence remains null and is distinct from empty tables", async () => {
  const db = new DatabaseSync(":memory:"), fixture = nativeFixture(db);
  const actual = await readLegacyDomainSnapshots(async () => fixture.native, accountScope);
  assert.ok(Object.values(actual.nutrition.tables).every((rows) => rows === null));
  assert.equal(actual.measurements.rows, null); assert.equal(actual.calendar.appointments, null);
  assert.equal(fixture.closed(), true);
});

test("all domains share one pinned WAL read transaction despite a concurrent writer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-source-wal-")), path = join(dir, "inspection.db");
  const writer = new DatabaseSync(path); let updated = false;
  try {
    writer.exec("PRAGMA journal_mode=WAL"); seed(writer);
    const reader = new DatabaseSync(path), fixture = nativeFixture(reader, undefined, (sql) => {
      if (!updated && sql === 'SELECT count(*) AS n FROM "client_day_facts"') {
        updated = true; writer.exec("BEGIN; UPDATE client_day_facts SET weight='99'; UPDATE calendar_appointments SET note='New note'; COMMIT");
      }
    });
    const actual = await readLegacyDomainSnapshots(async () => fixture.native, accountScope);
    assert.equal(updated, true); assert.equal(fixture.closed(), true);
    assert.equal(actual.nutrition.tables.client_day_facts![0]!.weight, "80.1");
    assert.deepEqual(actual.measurements.clientDays, actual.nutrition.tables.client_day_facts);
    assert.equal(actual.calendar.appointments![0]!.note, " Original note ");
    assert.equal(writer.prepare("SELECT weight FROM client_day_facts LIMIT 1").get()!.weight, "99");
  } finally { writer.close(); cleanup(dir); }
});

test("every native read/configuration failure closes the snapshot, keeps source bytes, and permits retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-source-retry-")), path = join(dir, "inspection.db");
  try {
    const initial = new DatabaseSync(path); seed(initial); initial.close();
    const bytes = readFileSync(path), first = nativeFixture(new DatabaseSync(path, { readOnly: true }));
    const expected = await readLegacyDomainSnapshots(async () => first.native, accountScope);
    const boundaries = first.calls.filter((sql) => sql !== "ROLLBACK" && sql !== "CLOSE").length;
    assert.ok(boundaries > 50);
    for (let failAt = 0; failAt < boundaries; failAt++) {
      let index = 0;
      const fixture = nativeFixture(new DatabaseSync(path, { readOnly: true }), () => { if (index++ === failAt) throw new Error("PRIVATE_SOURCE_FRAGMENT"); });
      await assert.rejects(readLegacyDomainSnapshots(async () => fixture.native, accountScope), { message: "R04_SOURCE_READ_FAILED" });
      assert.equal(fixture.closed(), true, `close at ${failAt}`); assert.deepEqual(readFileSync(path), bytes);
    }
    const retry = nativeFixture(new DatabaseSync(path, { readOnly: true }));
    assert.deepEqual(await readLegacyDomainSnapshots(async () => retry.native, accountScope), expected);
    assert.deepEqual(readFileSync(path), bytes);
  } finally { cleanup(dir); }
});

test("unsafe SQL integers and infinities are rejected before the native row bridge can round them", async () => {
  for (const value of ["9007199254740993", "-9007199254740993", "1e400", "-1e400"]) {
    const db = source(); db.exec(`UPDATE nutrition_days SET water_ml=${value}`);
    assert.throws(() => readLegacyNutritionInSnapshot(db, accountScope), { message: "R04_SOURCE_SQL_NUMBER_UNREPRESENTABLE" });
    const fixture = nativeFixture(db);
    await assert.rejects(readLegacyDomainSnapshots(async () => fixture.native, accountScope), { message: "R04_SOURCE_SQL_NUMBER_UNREPRESENTABLE" });
    assert.equal(fixture.closed(), true);
    assert.equal(fixture.calls.includes('SELECT * FROM "nutrition_days"'), false);
  }
  const db = source(); db.exec("UPDATE nutrition_days SET water_ml=9007199254740991");
  const fixture = nativeFixture(db), result = await readLegacyDomainSnapshots(async () => fixture.native, accountScope);
  assert.equal(result.nutrition.tables.nutrition_days![0]!.water_ml, Number.MAX_SAFE_INTEGER);
  const generated = source(); generated.exec("ALTER TABLE nutrition_days ADD COLUMN extra INTEGER GENERATED ALWAYS AS (9007199254740993) VIRTUAL");
  const generatedFixture = nativeFixture(generated);
  await assert.rejects(readLegacyDomainSnapshots(async () => generatedFixture.native, accountScope), { message: "R04_SOURCE_SQL_NUMBER_UNREPRESENTABLE" });
  assert.equal(generatedFixture.closed(), true); assert.equal(generatedFixture.calls.includes('SELECT * FROM "nutrition_days"'), false);
});

test("views and wrong shapes cannot masquerade as absent optional source tables", async () => {
  for (const [ddl, message] of [
    ["CREATE VIEW nutrition_days AS SELECT 1 AS id", "R04_NUTRITION_SOURCE_SHAPE_UNSUPPORTED"],
    ["CREATE VIEW client_measurements AS SELECT 1 AS id", "R04_MEASUREMENT_SHAPE_UNSUPPORTED"],
    ["CREATE VIEW calendar_appointments AS SELECT 1 AS id", "R04_CALENDAR_SOURCE_SHAPE_UNSUPPORTED"],
    ["CREATE TABLE food_products(id TEXT)", "R04_NUTRITION_SOURCE_SHAPE_UNSUPPORTED"],
  ]) {
    const db = new DatabaseSync(":memory:"); db.exec(ddl!); const fixture = nativeFixture(db);
    await assert.rejects(readLegacyDomainSnapshots(async () => fixture.native, accountScope), { message }); assert.equal(fixture.closed(), true);
  }
});

test("connection configuration must be observed before any source table is read", async () => {
  for (const [name, wrong] of [["query_only", 0], ["foreign_keys", 0], ["read_uncommitted", 1], ["trusted_schema", 1]] as const) {
    const fixture = nativeFixture(source()), native: NativeLegacySourceDatabase = { ...fixture.native,
      getAllAsync: async <Row>(sql: string, ...args: unknown[]): Promise<Row[]> => sql === `PRAGMA ${name}` ? [{ [name]: wrong }] as Row[] : fixture.native.getAllAsync<Row>(sql, ...args as (string | number | null)[]) };
    await assert.rejects(readLegacyDomainSnapshots(async () => native, accountScope), { message: "R04_SOURCE_CONNECTION_CONFIGURATION_UNAVAILABLE" });
    assert.equal(fixture.closed(), true); assert.equal(fixture.calls.some((sql) => /SELECT/u.test(sql)), false);
  }
  let opened = false;
  await assert.rejects(readLegacyDomainSnapshots(async () => { opened = true; throw new Error("PRIVATE_PATH"); }, " "), { message: "R04_ACCOUNT_SCOPE_REQUIRED" });
  assert.equal(opened, false);
  await assert.rejects(readLegacyDomainSnapshots(async () => { throw new Error("PRIVATE_PATH"); }, accountScope), { message: "R04_SOURCE_READ_FAILED" });
});

test("lost rows fail per-domain coverage checks rather than disappearing from the import", async () => {
  for (const [table, message] of [["nutrition_days", "R04_NUTRITION_SOURCE_COVERAGE_MISMATCH"],
    ["client_measurements", "R04_MEASUREMENT_CARDINALITY_MISMATCH"], ["calendar_appointments", "R04_CALENDAR_SOURCE_COVERAGE_MISMATCH"]]) {
    const fixture = nativeFixture(source()), native: NativeLegacySourceDatabase = { ...fixture.native,
      getAllAsync: async <Row>(sql: string, ...args: unknown[]): Promise<Row[]> => {
        const rows = await fixture.native.getAllAsync<Row>(sql, ...args as (string | number | null)[]);
        return sql === `SELECT * FROM "${table}"` ? rows.slice(1) : rows;
      },
    };
    await assert.rejects(readLegacyDomainSnapshots(async () => native, accountScope), { message }); assert.equal(fixture.closed(), true);
  }
});

test("failed rollback or close is reported and cannot hide an earlier read error", async () => {
  for (const cleanupFailure of ["ROLLBACK", "CLOSE"]) for (const primaryFailure of [false, true]) {
    const fixture = nativeFixture(source(), (sql) => { if (primaryFailure && sql === 'SELECT * FROM "nutrition_days"') throw new Error("PRIVATE_READ_FAILURE"); });
    const native: NativeLegacySourceDatabase = { ...fixture.native,
      execAsync: async (sql) => { if (cleanupFailure === "ROLLBACK" && sql === "ROLLBACK") throw new Error("PRIVATE_ROLLBACK_FAILURE"); await fixture.native.execAsync(sql); },
      closeAsync: async () => { await fixture.native.closeAsync(); if (cleanupFailure === "CLOSE") throw new Error("PRIVATE_CLOSE_FAILURE"); },
    };
    await assert.rejects(readLegacyDomainSnapshots(async () => native, accountScope), { message: primaryFailure ? "R04_SOURCE_READ_FAILED" : "R04_SOURCE_SNAPSHOT_CLOSE_FAILED" });
    assert.equal(fixture.closed(), true);
  }
});
