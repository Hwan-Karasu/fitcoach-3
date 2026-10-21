import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository } from "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import { DevNutritionCalcRepository } from "../apps/mobile/src/features/nutrition/data/DevNutritionCalcRepository.ts";
import { saveDayData } from "../apps/mobile/src/features/nutrition/presentation/dayData.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 9, 21, 12, 0);
const DAY = "2026-10-10";

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  const calc = new DevNutritionCalcRepository(shared, WS);
  await calc.initialize();
  const clientId = (await clients.create({ displayName: "SyntheticDay" })).id;
  const record = (valueX10: number, localDate: string) => measurements.record(clientId, { type: "WEIGHT", valueX10, localDate, localMinute: null }, NOW);
  const close = async () => { await calc.close(); await measurements.close(); await clients.close(); };
  return { measurements, calc, clientId, record, close };
}

test("данные дня за прошлую дату: вес, шаги и тренировка пишутся каждое отдельно", async () => {
  const { measurements, calc, clientId, record, close } = await stores();
  try {
    const errors = await saveDayData({ clientId, calc, recordWeight: record }, { localDate: DAY, weight: "85,4", steps: "8000", workout: "YES" });
    assert.deepEqual(errors, {});
    assert.deepEqual((await calc.listSteps(clientId, DAY, DAY)).map((row) => row.steps), [8000]);
    assert.deepEqual(await calc.listWorkoutMarks(clientId, DAY, DAY), [{ localDate: DAY, done: true }]);
    assert.deepEqual((await measurements.listForClient(clientId)).measurements.map((row) => [row.localDate, row.valueX10]), [[DAY, 854]]);
  } finally { await close(); }
});

test("сбой или неверный ввод одного значения не мешает записи остальных; ошибка — по полю", async () => {
  const { calc, clientId, close } = await stores();
  try {
    const broken = async () => { throw new Error("MEASUREMENT_VALUE_INVALID"); };
    assert.deepEqual(await saveDayData({ clientId, calc, recordWeight: broken }, { localDate: DAY, weight: "5", steps: "9000", workout: "NO" }),
      { weight: "Вес вне допустимого диапазона (20–400 кг)." });
    assert.deepEqual((await calc.listSteps(clientId, DAY, DAY)).map((row) => row.steps), [9000], "шаги записаны, хотя вес отклонён");
    assert.deepEqual(await calc.listWorkoutMarks(clientId, DAY, DAY), [{ localDate: DAY, done: false }]);
    const errors = await saveDayData({ clientId, calc, recordWeight: broken }, { localDate: DAY, weight: "abc", steps: "12x", workout: "YES" });
    assert.deepEqual(Object.keys(errors).sort(), ["steps", "weight"], "ошибки ввода только у своих полей");
    assert.deepEqual(await calc.listWorkoutMarks(clientId, DAY, DAY), [{ localDate: DAY, done: true }], "тренировка записана");
    assert.deepEqual((await calc.listSteps(clientId, DAY, DAY)).map((row) => row.steps), [9000], "неверные шаги прежнее значение не меняют");
  } finally { await close(); }
});

test("пустое поле: шаги очищают день, тренировка «нет данных» снимает отметку, пустой вес и нетронутые поля не пишутся", async () => {
  const { measurements, calc, clientId, record, close } = await stores();
  try {
    const ports = { clientId, calc, recordWeight: record };
    await saveDayData(ports, { localDate: DAY, weight: "80", steps: "5000", workout: "YES" });
    assert.deepEqual(await saveDayData(ports, { localDate: DAY, weight: "", steps: null, workout: null }), {});
    assert.equal((await calc.listSteps(clientId, DAY, DAY)).length, 1, "шаги не тронуты");
    assert.equal((await measurements.listForClient(clientId)).measurements.length, 1, "пустой вес ничего не записал");
    assert.deepEqual(await saveDayData(ports, { localDate: DAY, weight: null, steps: "", workout: "NONE" }), {});
    assert.deepEqual(await calc.listSteps(clientId, DAY, DAY), []);
    assert.deepEqual(await calc.listWorkoutMarks(clientId, DAY, DAY), []);
  } finally { await close(); }
});
