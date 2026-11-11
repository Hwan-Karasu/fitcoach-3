import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from
  "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import type { MeasurementInput } from "../apps/mobile/src/features/measurements/domain/MeasurementModel.ts";
import { upsertDailyMeasurement } from "../apps/mobile/src/features/measurements/domain/DailyMeasurement.ts";
import { dailyPoints, formatDecimal, formatValue, latestPoint, parseTime, parseValue, validateMeasurement } from
  "../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 9, 16, 21, 0);

async function stores(participants = true) {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, participants ? [devMeasurementClientDeletionParticipant] : []);
  await clients.initialize();
  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  const close = async () => { await measurements.close(); await clients.close(); };
  return { db, clients, measurements, close };
}

// Помощник принимает десятые доли (80,1 → 801), как раньше читаются остальные проверки; хранение — сотые (UIX-FIT-10).
const weight = (valueX10: number, localMinute: number | null, localDate = "2026-10-14"): MeasurementInput =>
  ({ type: "WEIGHT", valueX100: valueX10 * 10, localDate, localMinute });

test("AUDIT-ALL-1: параллельные дневные записи не создают неоднозначный день; явные записи журнала остаются независимыми", async () => {
  const { clients, measurements, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Synthetic daily race" });
    const [first, second] = await Promise.all([
      upsertDailyMeasurement(measurements, client.id, weight(800, 480), NOW),
      upsertDailyMeasurement(measurements, client.id, weight(810, null), NOW),
    ]);
    assert.equal(first.id, second.id);
    const day = await measurements.listForClient(client.id);
    assert.equal(day.measurements.length, 1);
    assert.equal(day.measurements[0]!.valueX100, 8100);
    assert.equal(day.measurements[0]!.localMinute, 480, "правка дневного значения сохраняет время исходного факта");
    await measurements.record(client.id, weight(820, 600), NOW);
    await assert.rejects(upsertDailyMeasurement(measurements, client.id, weight(830, null), NOW), { message: "MEASUREMENT_AMBIGUOUS_DAY" });
    await measurements.setPrimary(first.id);
    await upsertDailyMeasurement(measurements, client.id, weight(840, null), NOW);
    assert.equal((await measurements.listForClient(client.id)).measurements.find((row) => row.id === first.id)!.valueX100, 8400);
  } finally { await close(); }
});

test("AUDIT-ALL-1: условный импорт не создаёт второй факт, когда ручная запись уже стоит в очереди", async () => {
  const { clients, measurements, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Synthetic manual wins" });
    let events = 0;
    measurements.subscribeCommittedChanges(() => { events += 1; });
    const [manual, imported] = await Promise.all([
      measurements.record(client.id, weight(900, 480), NOW),
      measurements.recordIfDayEmpty(client.id, weight(800, null), NOW),
    ]);
    assert.equal(imported, null);
    assert.equal(events, 1, "пропуск импорта не публикует несуществующее изменение");
    const data = await measurements.listForClient(client.id);
    assert.deepEqual(data.measurements.map((row) => [row.id, row.valueX100]), [[manual.id, 9000]]);
    const nextDay = await measurements.recordIfDayEmpty(client.id, weight(805, null, "2026-10-15"), NOW);
    assert.equal(nextDay?.valueX100, 8050);
  } finally { await close(); }
});

test("C06 values are exact hundredths for weight and tenths for the rest; empty is not zero; future and implausible values are refused", () => {
  // Ожидаемые значения — из требования владельца (вес до сотых: 88,35), а не вычислены кодом.
  assert.equal(parseValue("80,1", "WEIGHT"), 8010);
  assert.equal(parseValue("80.1", "WEIGHT"), 8010);
  assert.equal(parseValue("88,35", "WEIGHT"), 8835);
  assert.equal(parseValue("88,04", "WEIGHT"), 8804);
  assert.equal(parseValue(" 80 ", "WEIGHT"), 8000);
  assert.equal(parseValue("", "WEIGHT"), null);
  assert.equal(parseValue("80,155", "WEIGHT"), null, "у массы тела не больше двух знаков");
  assert.equal(parseValue("-3", "WEIGHT"), null);
  assert.equal(parseValue("97,5", "WAIST"), 9750);
  assert.equal(parseValue("97,55", "WAIST"), null, "у обхватов один знак");
  assert.equal(parseValue("25,55", "BODY_FAT"), null, "у процента жира один знак");
  assert.equal(formatValue(8010, "WEIGHT"), "80,1 кг");
  assert.equal(formatValue(8835, "WEIGHT"), "88,35 кг");
  assert.equal(formatValue(8804, "WEIGHT"), "88,04 кг");
  assert.equal(formatValue(8800, "WEIGHT"), "88 кг");
  assert.equal(formatValue(7800, "WAIST"), "78 см");
  assert.equal(formatDecimal(-250), "-2,5");
  // Точность проверяет и схема правил: вес — любые сотые, обхват и % жира — только десятые.
  assert.doesNotThrow(() => validateMeasurement({ type: "WEIGHT", valueX100: 8835, localDate: "2026-10-14", localMinute: null }, NOW));
  assert.throws(() => validateMeasurement({ type: "WAIST", valueX100: 7855, localDate: "2026-10-14", localMinute: null }, NOW), { message: "MEASUREMENT_VALUE_INVALID" });
  assert.throws(() => validateMeasurement({ type: "BODY_FAT", valueX100: 2555, localDate: "2026-10-14", localMinute: null }, NOW), { message: "MEASUREMENT_VALUE_INVALID" });
  assert.equal(parseTime("08:05"), 485);
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("24:00"), "invalid");
  assert.throws(() => validateMeasurement(weight(8010, 480), NOW), { message: "MEASUREMENT_VALUE_INVALID" });
  assert.throws(() => validateMeasurement(weight(801, 480, "2026-10-17"), NOW), { message: "MEASUREMENT_DATE_INVALID" });
  assert.throws(() => validateMeasurement({ ...weight(801, 480), type: "FOOT" as never }, NOW),
    { message: "MEASUREMENT_TYPE_INVALID" });
});

test("NT-04 / §49.15–49.18: two weights a day stay separate; a primary gives one point; no average", async () => {
  const { clients, measurements, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Alpha" });
    const other = await clients.create({ displayName: "Beta" });
    const morning = await measurements.record(client.id, weight(801, 480), NOW);
    const evening = await measurements.record(client.id, weight(808, 1200), NOW);
    await measurements.record(client.id, { type: "WAIST", valueX100: 7800, localDate: "2026-10-14", localMinute: null }, NOW);
    await measurements.record(other.id, weight(950, 480), NOW);
    let data = await measurements.listForClient(client.id);
    assert.equal(data.measurements.length, 3);
    assert.deepEqual(data.measurements.map((row) => row.localMinute), [1200, 480, null]);
    let [point] = dailyPoints(data.measurements, data.primaries, "WEIGHT");
    assert.equal(point?.kind, "AMBIGUOUS");
    await measurements.setPrimary(morning.id);
    data = await measurements.listForClient(client.id);
    [point] = dailyPoints(data.measurements, data.primaries, "WEIGHT");
    assert.ok(point?.kind === "VALUE" && point.measurement.valueX100 === 8010 && point.chosen);
    await measurements.setPrimary(evening.id);
    data = await measurements.listForClient(client.id);
    assert.equal(data.primaries.length, 1);
    assert.ok(latestPoint(data.measurements, data.primaries, "WEIGHT")?.kind === "VALUE");
    assert.equal(data.measurements.length, 3);
    const corrected = await measurements.correct(evening.id, evening.revision, weight(806, 1200), NOW);
    assert.equal(corrected.id, evening.id);
    assert.equal((await measurements.listForClient(client.id)).measurements
      .find((row) => row.id === morning.id)?.valueX100, 8010);
    await assert.rejects(measurements.correct(evening.id, evening.revision, weight(805, 1200), NOW),
      { message: "MEASUREMENT_STALE" });
    assert.equal(latestPoint(data.measurements, data.primaries, "NECK"), null);
    assert.equal((await measurements.listForClient(other.id)).measurements.length, 1);
  } finally { await close(); }
});

test("§49.18.4 deleting the primary unlinks it without promoting; moving a fact releases its mark", async () => {
  const { clients, measurements, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Gamma" });
    const a = await measurements.record(client.id, weight(801, 480), NOW);
    const b = await measurements.record(client.id, weight(805, 600), NOW);
    const c = await measurements.record(client.id, weight(808, 1200), NOW);
    await measurements.setPrimary(a.id);
    await measurements.remove(a.id, a.revision);
    let data = await measurements.listForClient(client.id);
    assert.equal(data.primaries.length, 0);
    assert.equal(dailyPoints(data.measurements, data.primaries, "WEIGHT")[0]?.kind, "AMBIGUOUS");
    await measurements.setPrimary(b.id);
    await measurements.correct(b.id, b.revision, weight(805, 600, "2026-10-13"), NOW);
    data = await measurements.listForClient(client.id);
    assert.equal(data.primaries.length, 0);
    const points = dailyPoints(data.measurements, data.primaries, "WEIGHT");
    assert.deepEqual(points.map((point) => [point.localDate, point.kind]),
      [["2026-10-13", "VALUE"], ["2026-10-14", "VALUE"]]);
    assert.ok(points[1]?.kind === "VALUE" && points[1].measurement.id === c.id && !points[1].chosen);
  } finally { await close(); }
});

test("schema refuses a primary for another type or date and keeps foreign keys", async () => {
  const { db, clients, measurements, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Delta" });
    const row = await measurements.record(client.id, weight(801, 480), NOW);
    assert.throws(() => db.prepare(`INSERT INTO measurement_daily_primary
      (workspace_id, client_id, type, local_date, measurement_id) VALUES (?, ?, 'WAIST', ?, ?)`)
      .run(WS, client.id, "2026-10-14", row.id), /FOREIGN KEY/u);
    assert.throws(() => db.prepare(`INSERT INTO body_measurements (id, workspace_id, client_id, type, value_x100,
      local_date, local_minute, method, revision, created_at, updated_at)
      VALUES ('x', ?, 'missing', 'WEIGHT', 8000, '2026-10-14', NULL, 'MANUAL', 1, 'n', 'n')`).run(WS), /FOREIGN KEY/u);
  } finally { await close(); }
});

test("§15.7 permanent client delete removes the journal of that client only; without the owner it fails closed", async () => {
  const { clients, measurements, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "Gone" });
    const kept = await clients.create({ displayName: "Kept" });
    const row = await measurements.record(gone.id, weight(801, 480), NOW);
    await measurements.setPrimary(row.id);
    await measurements.record(kept.id, weight(700, 480), NOW);
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    const manifest = await clients.previewPermanentDelete(gone.id);
    assert.equal(manifest.owners.find((entry) => entry.owner === "measurements.body")?.rows, 1);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.equal((await measurements.listForClient(gone.id)).measurements.length, 0);
    assert.equal((await measurements.listForClient(kept.id)).measurements.length, 1);
  } finally { await close(); }
  const blocked = await stores(false);
  try {
    const client = await blocked.clients.create({ displayName: "Blocked" });
    await blocked.measurements.record(client.id, weight(801, 480), NOW);
    const archived = await blocked.clients.setArchived(client.id, client.revision, true);
    await assert.rejects(blocked.clients.deleteArchivedPermanently(client.id, archived.revision),
      { message: "CLIENT_DELETION_BLOCKED" });
    assert.equal((await blocked.measurements.listForClient(client.id)).measurements.length, 1);
  } finally { await blocked.close(); }
});

test("Z-хвост пакетная запись замеров: запись, правка и удаление дня — одной транзакцией, одно событие", async () => {
  const { clients, measurements, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticBatch" });
    const waist = await measurements.record(client.id, { type: "WAIST", valueX100: 8000, localDate: "2026-10-14", localMinute: null }, NOW);
    const chest = await measurements.record(client.id, { type: "CHEST", valueX100: 10000, localDate: "2026-10-14", localMinute: null }, NOW);
    let events = 0;
    measurements.subscribeCommittedChanges(() => { events += 1; });
    await measurements.applyBatch(client.id, [
      { kind: "correct", id: waist.id, expectedRevision: waist.revision, input: { type: "WAIST", valueX100: 7950, localDate: "2026-10-14", localMinute: null } },
      { kind: "remove", id: chest.id, expectedRevision: chest.revision },
      { kind: "record", input: { type: "HIPS", valueX100: 10200, localDate: "2026-10-14", localMinute: null } },
    ], NOW);
    assert.equal(events, 1);
    const day = (await measurements.listForClient(client.id)).measurements;
    assert.deepEqual(day.map((row) => [row.type, row.valueX100]).sort(), [["HIPS", 10200], ["WAIST", 7950]]);
  } finally { await close(); }
});

test("Z-хвост пакетная запись замеров: устаревшая revision или неверное значение не оставляют частичного результата", async () => {
  const { clients, measurements, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticBatchFail" });
    const other = await clients.create({ displayName: "SyntheticBatchOther" });
    const waist = await measurements.record(client.id, { type: "WAIST", valueX100: 8000, localDate: "2026-10-14", localMinute: null }, NOW);
    const foreign = await measurements.record(other.id, { type: "WAIST", valueX100: 9000, localDate: "2026-10-14", localMinute: null }, NOW);
    let events = 0;
    measurements.subscribeCommittedChanges(() => { events += 1; });
    const record = (valueX100: number) => ({ kind: "record" as const, input: { type: "HIPS" as const, valueX100, localDate: "2026-10-14", localMinute: null } });
    await assert.rejects(measurements.applyBatch(client.id, [record(1020),
      { kind: "remove", id: waist.id, expectedRevision: waist.revision + 1 }], NOW), { message: "MEASUREMENT_STALE" });
    await assert.rejects(measurements.applyBatch(client.id, [record(1020), record(5)], NOW), { message: "MEASUREMENT_VALUE_INVALID" });
    await assert.rejects(measurements.applyBatch(client.id, [record(1020),
      { kind: "remove", id: foreign.id, expectedRevision: foreign.revision }], NOW), { message: "MEASUREMENT_STALE" });
    assert.equal(events, 0);
    assert.deepEqual((await measurements.listForClient(client.id)).measurements.map((row) => row.type), ["WAIST"]);
    assert.equal((await measurements.listForClient(other.id)).measurements.length, 1, "чужая запись не удалена");
    await measurements.applyBatch(client.id, [], NOW);
    assert.equal(events, 0, "пустой пакет ничего не публикует");
  } finally { await close(); }
});
