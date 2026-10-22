import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { devMeasurementCatalog, DEV_MEASUREMENT_LEDGER } from "./d01/history/DevMeasurementCatalog.ts";
import { DevMeasurementRepository } from "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import { MEASUREMENT_GROUPS, MEASUREMENT_TYPES } from "../apps/mobile/src/features/measurements/domain/MeasurementModel.ts";
import { upsertDailyMeasurement } from "../apps/mobile/src/features/measurements/domain/DailyMeasurement.ts";
import { dailyPoints, measurementTypeInfo, validateMeasurement } from "../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { importHistoricalFixture } from "./support/import-historical-fixture.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 9, 20, 21, 0);
const DAY = "2026-10-20";

test("NUT-FS-07…09: набор замеров — живот, плечо/предплечье/бедро/голень по сторонам; старые «Рука/Бедро/Икра» остаются без стороны", () => {
  for (const type of ["ABDOMEN", "ARM_L", "ARM_R", "FOREARM_L", "FOREARM_R", "THIGH_L", "THIGH_R", "CALF_L", "CALF_R", "ARM", "THIGH", "CALF"]) assert.ok((MEASUREMENT_TYPES as readonly string[]).includes(type), type);
  assert.deepEqual(MEASUREMENT_GROUPS.map((group) => group.id), ["NECK", "SHOULDERS", "CHEST", "WAIST", "ABDOMEN", "HIPS", "BICEPS", "FOREARM", "THIGH", "CALF"]);
  const biceps = MEASUREMENT_GROUPS.find((group) => group.id === "BICEPS");
  assert.deepEqual([biceps?.left, biceps?.right, biceps?.legacy], ["ARM_L", "ARM_R", "ARM"], "старая «Рука» — значение без указания стороны");
  assert.equal(MEASUREMENT_GROUPS.find((group) => group.id === "FOREARM")?.legacy ?? null, null);
  assert.equal(MEASUREMENT_GROUPS.find((group) => group.id === "NECK")?.left ?? null, null, "односторонние показатели без Л/П");
  assert.equal(measurementTypeInfo.ARM_L.unit, "см");
  assert.equal(measurementTypeInfo.ARM_L.minX10, 100);
  assert.throws(() => validateMeasurement({ type: "ARM_X" as never, valueX10: 330, localDate: DAY, localMinute: null }, NOW), { message: "MEASUREMENT_TYPE_INVALID" });
  assert.equal(validateMeasurement({ type: "ARM_L", valueX10: 330, localDate: DAY, localMinute: null }, NOW).type, "ARM_L");
});

test("замеры руки: плечо и предплечье, а не «бицепс» (замеряется обхват плеча, а не мышцы)", () => {
  assert.equal(MEASUREMENT_GROUPS.find((group) => group.id === "BICEPS")?.label, "Плечо");
  assert.equal(MEASUREMENT_GROUPS.find((group) => group.id === "FOREARM")?.label, "Предплечье");
  assert.equal(measurementTypeInfo.ARM_L.label, "Плечо, левое");
  assert.equal(measurementTypeInfo.ARM_R.label, "Плечо, правое");
  assert.equal(measurementTypeInfo.FOREARM_L.label, "Предплечье, левое");
  assert.equal(measurementTypeInfo.FOREARM_R.label, "Предплечье, правое");
});

test("NUT-FS-08, 12: левая и правая сторона — независимые ряды (одна сторона — допустимо), старое значение не получает сторону", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await measurements.record(client.id, { type: "ARM", valueX10: 320, localDate: DAY, localMinute: null }, NOW);
    await measurements.record(client.id, { type: "ARM_L", valueX10: 330, localDate: DAY, localMinute: null }, NOW);
    await measurements.record(client.id, { type: "ARM_R", valueX10: 335, localDate: DAY, localMinute: null }, NOW);
    await measurements.record(client.id, { type: "FOREARM_L", valueX10: 280, localDate: DAY, localMinute: null }, NOW);
    await measurements.record(client.id, { type: "ABDOMEN", valueX10: 910, localDate: DAY, localMinute: null }, NOW);
    const data = await measurements.listForClient(client.id);
    for (const [type, value] of [["ARM", 320], ["ARM_L", 330], ["ARM_R", 335], ["FOREARM_L", 280], ["ABDOMEN", 910]] as const) {
      const [point] = dailyPoints(data.measurements, data.primaries, type);
      assert.equal(point?.kind, "VALUE", `${type}: одна запись на ряд — без неоднозначности`);
      assert.equal(point?.kind === "VALUE" ? point.measurement.valueX10 : null, value, type);
    }
    assert.deepEqual(dailyPoints(data.measurements, data.primaries, "FOREARM_R"), [], "правое предплечье не внесено — «нет данных», а не ноль и не копия левого");
  } finally { await measurements.close(); await clients.close(); }
});

test("миграция замеров v2: данные, основные значения дня и связи переживают пересоздание таблицы; новые типы принимаются, чужие — нет", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const client = await clients.create({ displayName: "Legacy" });
  await runMigrations(new WriterCoordinator(nodeSqlitePort(db)), devMeasurementCatalog.slice(0, 1), DEV_MEASUREMENT_LEDGER);
  const insert = db.prepare(`INSERT INTO body_measurements (id, workspace_id, client_id, type, value_x10, local_date, local_minute, method, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`);
  insert.run("m1", WS, client.id, "WEIGHT", 801, "2026-10-14", 480);
  insert.run("m2", WS, client.id, "WEIGHT", 808, "2026-10-14", 1200);
  insert.run("m3", WS, client.id, "ARM", 330, "2026-10-14", null);
  db.prepare("INSERT INTO measurement_daily_primary (workspace_id, client_id, type, local_date, measurement_id) VALUES (?, ?, 'WEIGHT', '2026-10-14', 'm2')").run(WS, client.id);

  const imported = await importHistoricalFixture(db, devMeasurementCatalog, DEV_MEASUREMENT_LEDGER);
  const measurements = new DevMeasurementRepository(imported.shared, WS);
  await measurements.initialize();
  try {
    const data = await measurements.listForClient(client.id);
    assert.deepEqual(data.measurements.map((row) => [row.id, row.type, row.valueX10]).sort(), [["m1", "WEIGHT", 801], ["m2", "WEIGHT", 808], ["m3", "ARM", 330]]);
    assert.deepEqual(data.primaries.map((row) => [row.type, row.localDate, row.measurementId]), [["WEIGHT", "2026-10-14", "m2"]], "основное значение дня сохранено");
    assert.equal((db.prepare(`SELECT count(*) AS n FROM ${DEV_MEASUREMENT_LEDGER}`).get() as { n: number }).n, 2, "исторические миграции v1 и v2 применены");
    assert.equal((imported.db.prepare(`SELECT count(*) AS n FROM ${DEV_MEASUREMENT_LEDGER}`).get() as { n: number }).n, 1, "новый файл использует baseline");
    const added = await measurements.record(client.id, { type: "CALF_R", valueX10: 380, localDate: "2026-10-15", localMinute: null }, NOW);
    assert.equal(added.type, "CALF_R");
    assert.throws(() => imported.db.prepare(`INSERT INTO body_measurements (id, workspace_id, client_id, type, value_x10, local_date, method, revision, created_at, updated_at)
      VALUES ('x', ?, ?, 'FOOT', 100, '2026-10-15', 'MANUAL', 1, 'a', 'a')`).run(WS, client.id), /CHECK|constraint/iu, "схема отклоняет неизвестный тип");
    assert.throws(() => imported.db.prepare("INSERT INTO measurement_daily_primary (workspace_id, client_id, type, local_date, measurement_id) VALUES (?, ?, 'ARM', '2026-10-14', 'm2')").run(WS, client.id),
      /FOREIGN|constraint/iu, "связь основного значения с типом и датой не потеряна");
  } finally { await measurements.close(); await clients.close(); }
});

test("запись дневного значения: нет записи — новая; одна запись — правится на месте (без второй); несколько без основной — отказ; время записи сохраняется", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const first = await upsertDailyMeasurement(measurements, client.id, { type: "WEIGHT", valueX10: 854, localDate: DAY, localMinute: 480 }, NOW);
    assert.equal(first.valueX10, 854);
    const corrected = await upsertDailyMeasurement(measurements, client.id, { type: "WEIGHT", valueX10: 851, localDate: DAY, localMinute: null }, NOW);
    assert.deepEqual([corrected.id, corrected.valueX10, corrected.localMinute], [first.id, 851, 480], "тот же факт, время прежнее");
    assert.equal((await measurements.listForClient(client.id)).measurements.length, 1, "второй записи за день нет");
    await measurements.record(client.id, { type: "WEIGHT", valueX10: 860, localDate: DAY, localMinute: 1200 }, NOW);
    await assert.rejects(upsertDailyMeasurement(measurements, client.id, { type: "WEIGHT", valueX10: 855, localDate: DAY, localMinute: null }, NOW), { message: "MEASUREMENT_AMBIGUOUS_DAY" });
    const other = await upsertDailyMeasurement(measurements, client.id, { type: "WEIGHT", valueX10: 850, localDate: "2026-10-19", localMinute: null }, NOW);
    assert.equal(other.localDate, "2026-10-19", "другая дата — новая запись");
  } finally { await measurements.close(); await clients.close(); }
});
