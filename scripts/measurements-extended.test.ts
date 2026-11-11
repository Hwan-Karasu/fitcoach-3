import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository } from "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import { MEASUREMENT_GROUPS, MEASUREMENT_TYPES } from "../apps/mobile/src/features/measurements/domain/MeasurementModel.ts";
import { upsertDailyMeasurement } from "../apps/mobile/src/features/measurements/domain/DailyMeasurement.ts";
import { dailyPoints, measurementTypeInfo, validateMeasurement } from "../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

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
  assert.equal(measurementTypeInfo.ARM_L.minX100, 1000);
  assert.throws(() => validateMeasurement({ type: "ARM_X" as never, valueX100: 3300, localDate: DAY, localMinute: null }, NOW), { message: "MEASUREMENT_TYPE_INVALID" });
  assert.equal(validateMeasurement({ type: "ARM_L", valueX100: 3300, localDate: DAY, localMinute: null }, NOW).type, "ARM_L");
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
    await measurements.record(client.id, { type: "ARM", valueX100: 3200, localDate: DAY, localMinute: null }, NOW);
    await measurements.record(client.id, { type: "ARM_L", valueX100: 3300, localDate: DAY, localMinute: null }, NOW);
    await measurements.record(client.id, { type: "ARM_R", valueX100: 3350, localDate: DAY, localMinute: null }, NOW);
    await measurements.record(client.id, { type: "FOREARM_L", valueX100: 2800, localDate: DAY, localMinute: null }, NOW);
    await measurements.record(client.id, { type: "ABDOMEN", valueX100: 9100, localDate: DAY, localMinute: null }, NOW);
    const data = await measurements.listForClient(client.id);
    for (const [type, value] of [["ARM", 3200], ["ARM_L", 3300], ["ARM_R", 3350], ["FOREARM_L", 2800], ["ABDOMEN", 9100]] as const) {
      const [point] = dailyPoints(data.measurements, data.primaries, type);
      assert.equal(point?.kind, "VALUE", `${type}: одна запись на ряд — без неоднозначности`);
      assert.equal(point?.kind === "VALUE" ? point.measurement.valueX100 : null, value, type);
    }
    assert.deepEqual(dailyPoints(data.measurements, data.primaries, "FOREARM_R"), [], "правое предплечье не внесено — «нет данных», а не ноль и не копия левого");
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
    const first = await upsertDailyMeasurement(measurements, client.id, { type: "WEIGHT", valueX100: 8540, localDate: DAY, localMinute: 480 }, NOW);
    assert.equal(first.valueX100, 8540);
    const corrected = await upsertDailyMeasurement(measurements, client.id, { type: "WEIGHT", valueX100: 8510, localDate: DAY, localMinute: null }, NOW);
    assert.deepEqual([corrected.id, corrected.valueX100, corrected.localMinute], [first.id, 8510, 480], "тот же факт, время прежнее");
    assert.equal((await measurements.listForClient(client.id)).measurements.length, 1, "второй записи за день нет");
    await measurements.record(client.id, { type: "WEIGHT", valueX100: 8600, localDate: DAY, localMinute: 1200 }, NOW);
    await assert.rejects(upsertDailyMeasurement(measurements, client.id, { type: "WEIGHT", valueX100: 8550, localDate: DAY, localMinute: null }, NOW), { message: "MEASUREMENT_AMBIGUOUS_DAY" });
    const other = await upsertDailyMeasurement(measurements, client.id, { type: "WEIGHT", valueX100: 8500, localDate: "2026-10-19", localMinute: null }, NOW);
    assert.equal(other.localDate, "2026-10-19", "другая дата — новая запись");
  } finally { await measurements.close(); await clients.close(); }
});
