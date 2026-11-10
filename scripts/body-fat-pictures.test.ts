import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository } from "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import { measurementsBaseline } from "../apps/mobile/src/features/measurements/data/MeasurementsBaseline.generated.ts";
import { DEV_MEASUREMENT_LEDGER, devMeasurementCatalog } from "../apps/mobile/src/features/measurements/data/DevMeasurementCatalog.ts";
import { BODY_FAT_PICTURES, pictureSetOf } from "../apps/mobile/src/features/measurements/domain/BodyFatPictures.ts";
import { dailyPoints, validateMeasurement } from "../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 10, 10, 12, 0);
const fat = (valueX10: number, method?: "MANUAL" | "VISUAL_ESTIMATE") =>
  ({ type: "BODY_FAT" as const, valueX10, localDate: "2026-11-10", localMinute: null, ...(method === undefined ? {} : { method }) });

test("UIX-06: девять рисунков на пол, подписи без пропусков, подставляется середина диапазона", () => {
  assert.deepEqual(BODY_FAT_PICTURES.MALE.map((entry) => entry.label), ["6–9", "10–13", "14–17", "18–21", "22–25", "26–29", "30–34", "35–39", "40+"]);
  assert.deepEqual(BODY_FAT_PICTURES.FEMALE.map((entry) => entry.label), ["14–17", "18–21", "22–25", "26–29", "30–33", "34–37", "38–41", "42–46", "47+"]);
  assert.deepEqual(BODY_FAT_PICTURES.MALE.map((entry) => entry.pickX10), [75, 115, 155, 195, 235, 275, 320, 370, 420]);
  assert.deepEqual(BODY_FAT_PICTURES.FEMALE.map((entry) => entry.pickX10), [155, 195, 235, 275, 315, 355, 395, 440, 485]);
  assert.deepEqual(BODY_FAT_PICTURES.MALE.map((entry) => entry.index), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(pictureSetOf(null), null);
  assert.equal(pictureSetOf("FEMALE"), "FEMALE");
});

test("UIX-06: метод «оценка по рисунку» допустим только для процента жира", () => {
  assert.equal(validateMeasurement(fat(155, "VISUAL_ESTIMATE"), NOW).method, "VISUAL_ESTIMATE");
  assert.throws(() => validateMeasurement({ type: "WEIGHT", valueX10: 800, localDate: "2026-11-10", localMinute: null, method: "VISUAL_ESTIMATE" }, NOW),
    { message: "MEASUREMENT_METHOD_INVALID" });
  assert.throws(() => validateMeasurement({ ...fat(155), method: "NAVY_ESTIMATE" as never }, NOW), { message: "MEASUREMENT_METHOD_INVALID" });
});

test("UIX-06: запись и чтение замера с методом «по рисунку»; ручная правка возвращает MANUAL", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS);
  await clients.initialize();
  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  try {
    const client = await clients.create({ displayName: "SyntheticFat" });
    const picked = await measurements.record(client.id, fat(155, "VISUAL_ESTIMATE"), NOW);
    assert.equal(picked.method, "VISUAL_ESTIMATE");
    const manual = await measurements.record(client.id, { ...fat(160), localDate: "2026-11-09" }, NOW);
    assert.equal(manual.method, "MANUAL");
    const fixed = await measurements.correct(picked.id, picked.revision, fat(162), NOW);
    assert.equal(fixed.method, "MANUAL");
    const again = await measurements.correct(fixed.id, fixed.revision, fat(195, "VISUAL_ESTIMATE"), NOW);
    assert.equal(again.method, "VISUAL_ESTIMATE");
    // Правка только времени не меняет способ получения значения.
    const retimed = await measurements.correct(again.id, again.revision, { ...fat(195), localMinute: 600 }, NOW);
    assert.equal(retimed.method, "VISUAL_ESTIMATE");
    assert.equal(retimed.localMinute, 600);
    const listed = await measurements.listForClient(client.id);
    const point = dailyPoints(listed.measurements, listed.primaries, "BODY_FAT").find((entry) => entry.localDate === "2026-11-10");
    assert.ok(point?.kind === "VALUE" && point.measurement.method === "VISUAL_ESTIMATE" && point.measurement.valueX10 === 195);
    assert.throws(() => db.prepare(`INSERT INTO body_measurements (id, workspace_id, client_id, type, value_x10, local_date, local_minute, method, revision, created_at, updated_at)
      VALUES ('x', ?, ?, 'BODY_FAT', 200, '2026-11-10', NULL, 'GUESS', 1, 'n', 'n')`).run(WS, client.id), /CHECK/u);
  } finally { await measurements.close(); await clients.close(); }
});

test("UIX-06: миграция v2 сохраняет замеры и основные значения дня, схема допускает новый метод", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS);
  await clients.initialize();
  // Старая установка: только базовая миграция владельца замеров.
  const { writer } = await shared.acquire();
  await runMigrations(writer, measurementsBaseline, DEV_MEASUREMENT_LEDGER);
  await shared.release();
  const client = await clients.create({ displayName: "SyntheticLegacy" });
  const insert = db.prepare(`INSERT INTO body_measurements (id, workspace_id, client_id, type, value_x10, local_date, local_minute, method, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'n', 'n')`);
  insert.run("m1", WS, client.id, "WEIGHT", 801, "2026-11-01", 480, "MANUAL", 1);
  insert.run("m2", WS, client.id, "WEIGHT", 805, "2026-11-01", 1200, "MANUAL", 3);
  insert.run("m3", WS, client.id, "BODY_FAT", 182, "2026-11-01", null, "NAVY_ESTIMATE", 2);
  db.prepare(`INSERT INTO measurement_daily_primary (workspace_id, client_id, type, local_date, measurement_id) VALUES (?, ?, 'WEIGHT', '2026-11-01', 'm2')`).run(WS, client.id);

  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  try {
    assert.equal(devMeasurementCatalog.length, 2);
    assert.deepEqual(db.prepare(`SELECT version FROM ${DEV_MEASUREMENT_LEDGER} ORDER BY version`).all().map((row) => row["version"]), [1, 2]);
    const listed = await measurements.listForClient(client.id);
    assert.deepEqual(listed.measurements.map((row) => [row.id, row.valueX10, row.method, row.revision]).sort(),
      [["m1", 801, "MANUAL", 1], ["m2", 805, "MANUAL", 3], ["m3", 182, "NAVY_ESTIMATE", 2]]);
    assert.deepEqual(listed.primaries.map((entry) => ({ ...entry })), [{ type: "WEIGHT", localDate: "2026-11-01", measurementId: "m2" }]);
    // Внешний ключ основного значения и индексы после пересоздания на месте.
    assert.throws(() => db.prepare(`INSERT INTO measurement_daily_primary (workspace_id, client_id, type, local_date, measurement_id) VALUES (?, ?, 'WAIST', '2026-11-01', 'm1')`).run(WS, client.id), /FOREIGN KEY/u);
    assert.throws(() => db.prepare("DELETE FROM body_measurements WHERE id = 'm2'").run(), /FOREIGN KEY/u);
    const created = await measurements.record(client.id, fat(155, "VISUAL_ESTIMATE"), NOW);
    assert.equal(created.method, "VISUAL_ESTIMATE");
  } finally { await measurements.close(); await clients.close(); }
});
