import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from
  "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import type { MeasurementInput } from "../apps/mobile/src/features/measurements/domain/MeasurementModel.ts";
import { dailyPoints, formatValue, latestPoint, parseTime, parseValueX10, validateMeasurement } from
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

const weight = (valueX10: number, localMinute: number | null, localDate = "2026-10-14"): MeasurementInput =>
  ({ type: "WEIGHT", valueX10, localDate, localMinute });

test("C06 values are exact tenths; empty is not zero; future and implausible values are refused", () => {
  assert.equal(parseValueX10("80,1"), 801);
  assert.equal(parseValueX10("80.1"), 801);
  assert.equal(parseValueX10(" 80 "), 800);
  assert.equal(parseValueX10(""), null);
  assert.equal(parseValueX10("80,15"), null);
  assert.equal(parseValueX10("-3"), null);
  assert.equal(formatValue(801, "WEIGHT"), "80,1 кг");
  assert.equal(formatValue(780, "WAIST"), "78 см");
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
    await measurements.record(client.id, { type: "WAIST", valueX10: 780, localDate: "2026-10-14", localMinute: null }, NOW);
    await measurements.record(other.id, weight(950, 480), NOW);
    let data = await measurements.listForClient(client.id);
    assert.equal(data.measurements.length, 3);
    assert.deepEqual(data.measurements.map((row) => row.localMinute), [1200, 480, null]);
    let [point] = dailyPoints(data.measurements, data.primaries, "WEIGHT");
    assert.equal(point?.kind, "AMBIGUOUS");
    await measurements.setPrimary(morning.id);
    data = await measurements.listForClient(client.id);
    [point] = dailyPoints(data.measurements, data.primaries, "WEIGHT");
    assert.ok(point?.kind === "VALUE" && point.measurement.valueX10 === 801 && point.chosen);
    await measurements.setPrimary(evening.id);
    data = await measurements.listForClient(client.id);
    assert.equal(data.primaries.length, 1);
    assert.ok(latestPoint(data.measurements, data.primaries, "WEIGHT")?.kind === "VALUE");
    assert.equal(data.measurements.length, 3);
    const corrected = await measurements.correct(evening.id, evening.revision, weight(806, 1200), NOW);
    assert.equal(corrected.id, evening.id);
    assert.equal((await measurements.listForClient(client.id)).measurements
      .find((row) => row.id === morning.id)?.valueX10, 801);
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
    assert.throws(() => db.prepare(`INSERT INTO body_measurements (id, workspace_id, client_id, type, value_x10,
      local_date, local_minute, method, revision, created_at, updated_at)
      VALUES ('x', ?, 'missing', 'WEIGHT', 800, '2026-10-14', NULL, 'MANUAL', 1, 'n', 'n')`).run(WS), /FOREIGN KEY/u);
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
    const waist = await measurements.record(client.id, { type: "WAIST", valueX10: 800, localDate: "2026-10-14", localMinute: null }, NOW);
    const chest = await measurements.record(client.id, { type: "CHEST", valueX10: 1000, localDate: "2026-10-14", localMinute: null }, NOW);
    let events = 0;
    measurements.subscribeCommittedChanges(() => { events += 1; });
    await measurements.applyBatch(client.id, [
      { kind: "correct", id: waist.id, expectedRevision: waist.revision, input: { type: "WAIST", valueX10: 795, localDate: "2026-10-14", localMinute: null } },
      { kind: "remove", id: chest.id, expectedRevision: chest.revision },
      { kind: "record", input: { type: "HIPS", valueX10: 1020, localDate: "2026-10-14", localMinute: null } },
    ], NOW);
    assert.equal(events, 1);
    const day = (await measurements.listForClient(client.id)).measurements;
    assert.deepEqual(day.map((row) => [row.type, row.valueX10]).sort(), [["HIPS", 1020], ["WAIST", 795]]);
  } finally { await close(); }
});

test("Z-хвост пакетная запись замеров: устаревшая revision или неверное значение не оставляют частичного результата", async () => {
  const { clients, measurements, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticBatchFail" });
    const other = await clients.create({ displayName: "SyntheticBatchOther" });
    const waist = await measurements.record(client.id, { type: "WAIST", valueX10: 800, localDate: "2026-10-14", localMinute: null }, NOW);
    const foreign = await measurements.record(other.id, { type: "WAIST", valueX10: 900, localDate: "2026-10-14", localMinute: null }, NOW);
    let events = 0;
    measurements.subscribeCommittedChanges(() => { events += 1; });
    const record = (valueX10: number) => ({ kind: "record" as const, input: { type: "HIPS" as const, valueX10, localDate: "2026-10-14", localMinute: null } });
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
