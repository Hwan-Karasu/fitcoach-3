import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevHealthRepository, devHealthClientDeletionParticipant } from "../src/features/health/data/DevHealthRepository.ts";
import { isValidHealthValue } from "../src/features/health/domain/HealthModel.ts";
import type { HealthAvailability, HealthDayValue, HealthMetric } from "../src/features/health/public.ts";
import type { HealthConnectPort } from "../src/features/health/public.ts";
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from "../src/features/measurements/data/DevMeasurementRepository.ts";
import { dailyPoints } from "../src/features/measurements/domain/MeasurementRules.ts";
import { DevNutritionCalcRepository, devNutritionCalcClientDeletionParticipant } from "../src/features/nutrition/data/DevNutritionCalcRepository.ts";
import { devNutritionClientDeletionParticipant } from "../src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { devNutritionTargetsClientDeletionParticipant } from "../src/features/nutrition/data/DevNutritionTargetsRepository.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { syncHealthConnect } from "../src/workflows/syncHealthConnect.ts";
import { createHealthOperationQueue } from "../src/features/health/domain/HealthOperationQueue.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-11-10T09:00:00.000Z");
const TODAY = "2026-11-10";

class FakePlatform implements HealthConnectPort {
  availabilityValue: HealthAvailability = "AVAILABLE";
  granted: readonly HealthMetric[] = ["STEPS", "SLEEP_MIN", "WEIGHT_X10", "BODY_FAT_X10", "TOTAL_KCAL", "ACTIVE_KCAL"];
  data: HealthDayValue[] = [];
  reads: { metrics: readonly HealthMetric[]; from: string; to: string }[] = [];
  async availability() { return this.availabilityValue; }
  async grantedMetrics() { return this.granted; }
  async requestPermissions() { return this.granted; }
  async readDaily(metrics: readonly HealthMetric[], range: { from: string; to: string }) { this.reads.push({ metrics, ...range }); return this.data.filter((entry) => metrics.includes(entry.metric)); }
  openSettings() { /* не используется */ }
  async revokeAll() { this.granted = []; }
}

async function stores(participants = true) {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, participants ? [devMeasurementClientDeletionParticipant, devNutritionCalcClientDeletionParticipant, devNutritionClientDeletionParticipant,
    devNutritionTargetsClientDeletionParticipant, devHealthClientDeletionParticipant] : []);
  await clients.initialize();
  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  const calc = new DevNutritionCalcRepository(shared, WS);
  await calc.initialize();
  const health = new DevHealthRepository(shared, WS);
  await health.initialize();
  const close = async () => { await health.close(); await calc.close(); await measurements.close(); await clients.close(); };
  return { db, clients, measurements, calc, health, close };
}
const value = (localDate: string, metric: HealthMetric, v: number): HealthDayValue => ({ localDate, metric, value: v });

test("AUDIT-ALL-1: ручной вес между чтением журнала и импортом остаётся единственным, HC не создаёт неоднозначный день", async () => {
  const { clients, measurements, calc, health, close } = await stores();
  try {
    const me = await clients.create({ displayName: "SyntheticHealthConcurrent" });
    await health.link(me.id, NOW);
    let inserted = false;
    const delayed = new Proxy(measurements, { get(target, key) {
      if (key === "listForClient") return async (id: string) => {
        const snapshot = await target.listForClient(id);
        if (!inserted) {
          inserted = true;
          await target.record(id, { type: "WEIGHT", valueX10: 900, localDate: TODAY, localMinute: null }, NOW);
        }
        return snapshot;
      };
      const member = Reflect.get(target, key); return typeof member === "function" ? member.bind(target) : member;
    } });
    const platform = new FakePlatform(); platform.data = [value(TODAY, "WEIGHT_X10", 800)];
    const result = await syncHealthConnect({ health, calc, measurements: delayed, platform, isValidHealthValue }, TODAY, NOW);
    assert.equal(result.kind, "SYNCED");
    if (result.kind === "SYNCED") assert.equal(result.importedWeight, 0);
    const rows = (await measurements.listForClient(me.id)).measurements;
    assert.deepEqual(rows.map((row) => row.valueX10), [900]);
    await measurements.remove(rows[0]!.id, rows[0]!.revision);
    await syncHealthConnect({ health, calc, measurements, platform, isValidHealthValue }, TODAY, NOW);
    assert.equal((await measurements.listForClient(me.id)).measurements.length, 0, "удалённый вручную факт не возвращается на следующей синхронизации");
  } finally { await close(); }
});

test("AUDIT-ALL-1: нулевые и слишком большие шаги HC снимают прежнюю положительную проекцию Nutrition", async (t) => {
  const { clients, measurements, calc, health, close } = await stores();
  try {
    const me = await clients.create({ displayName: "SyntheticHealthZeroSteps" });
    await health.link(me.id, NOW);
    const platform = new FakePlatform();
    const stepReads = t.mock.method(calc, "listSteps");
    for (const steps of [5000, 0, 6000, 150_000]) {
      platform.data = [value(TODAY, "STEPS", steps)];
      const before = stepReads.mock.callCount();
      await syncHealthConnect({ health, calc, measurements, platform, isValidHealthValue }, TODAY, NOW);
      assert.equal(stepReads.mock.callCount(), before + 1, "одна сверка проекции на весь диапазон дат");
      assert.deepEqual((await calc.listSteps(me.id, TODAY, TODAY)).map((day) => day.steps), steps === 0 || steps > 100_000 ? [] : [steps]);
      assert.equal((await health.listDaily(me.id, TODAY, TODAY))[0]!.value, steps, "исходное допустимое HC-значение сохраняется");
    }
  } finally { await close(); }
});

test("AUDIT-ALL-1: после повторного подключения HC заменяет ручные шаги, даже если внешнее значение не менялось", async () => {
  const { clients, measurements, calc, health, close } = await stores();
  try {
    const me = await clients.create({ displayName: "SyntheticHealthRelinkSteps" });
    await health.link(me.id, NOW);
    const platform = new FakePlatform(); platform.data = [value(TODAY, "STEPS", 5000)];
    const run = () => syncHealthConnect({ health, calc, measurements, platform, isValidHealthValue }, TODAY, NOW);
    await run();
    await health.unlink(); await calc.setSteps(me.id, TODAY, 7000, NOW);
    await health.link(me.id, new Date(NOW.getTime() + 1000));
    await run();
    assert.deepEqual((await calc.listSteps(me.id, TODAY, TODAY)).map((day) => day.steps), [5000]);
  } finally { await close(); }
});

test("UIX audit: отключение и новая привязка ждут текущую синхронизацию; параллельные запросы делят один запуск", async () => {
  const { clients, health, close } = await stores();
  let release!: () => void;
  try {
    const me = await clients.create({ displayName: "SyntheticSelf" });
    const other = await clients.create({ displayName: "SyntheticOther" });
    await health.link(me.id, NOW);
    let calls = 0;
    const operations = createHealthOperationQueue(health, async () => {
      calls += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      assert.equal((await health.getLink())!.clientId, me.id);
      return "SYNCED";
    });
    const sync = operations.sync();
    assert.equal(operations.sync(), sync);
    const unlink = operations.store.unlink();
    const link = operations.store.link(other.id, new Date(NOW.getTime() + 1000));
    await Promise.resolve();
    assert.equal((await health.getLink())!.clientId, me.id);
    release();
    await Promise.all([sync, unlink, link]);
    assert.equal(calls, 1);
    assert.equal((await health.getLink())!.clientId, other.id);
  } finally { release?.(); await close(); }
});

test("UIX audit: смена привязки во время системного чтения не записывает данные прежнему клиенту", async () => {
  const { clients, health, calc, measurements, close } = await stores();
  try {
    const me = await clients.create({ displayName: "SyntheticSelf" });
    const other = await clients.create({ displayName: "SyntheticOther" });
    await health.link(me.id, NOW);
    const platform = new FakePlatform();
    platform.readDaily = async () => {
      await health.unlink(); await health.link(other.id, new Date(NOW.getTime() + 1000));
      return [value(TODAY, "WEIGHT_X10", 800), value(TODAY, "STEPS", 7000)];
    };
    assert.deepEqual(await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW), { kind: "NOT_LINKED" });
    assert.equal((await measurements.listForClient(me.id)).measurements.length, 0);
    assert.equal((await calc.listSteps(me.id, TODAY, TODAY)).length, 0);
  } finally { await close(); }
});

test("UIX audit: повтор дня во внешнем ответе не создаёт два замера и неоднозначный день", async () => {
  const { clients, health, calc, measurements, close } = await stores();
  try {
    const me = await clients.create({ displayName: "SyntheticSelf" });
    await health.link(me.id, NOW);
    const platform = new FakePlatform();
    platform.data = [value(TODAY, "WEIGHT_X10", 800), value(TODAY, "WEIGHT_X10", 810)];
    await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW);
    const rows = (await measurements.listForClient(me.id)).measurements;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.valueX10, 810);
  } finally { await close(); }
});

test("Health: одна привязка на рабочее пространство; повторная привязка той же карточки — как есть; другой — отказ; отключение не удаляет дни", async () => {
  const { clients, health, close } = await stores();
  try {
    const me = await clients.create({ displayName: "SyntheticSelf" });
    const other = await clients.create({ displayName: "SyntheticOther" });
    assert.equal(await health.getLink(), null);
    const link = await health.link(me.id, NOW);
    assert.deepEqual([link.clientId, link.lastSyncAt, link.grantedMetrics.length], [me.id, null, 0]);
    assert.equal((await health.link(me.id, NOW)).linkedAt, link.linkedAt);
    await assert.rejects(health.link(other.id, NOW), { message: "HEALTH_ALREADY_LINKED" });
    await health.saveSync(me.id, [value("2026-11-09", "STEPS", 8000)], ["STEPS"], NOW);
    await health.unlink();
    assert.equal(await health.getLink(), null);
    assert.deepEqual((await health.listDaily(me.id, "2026-11-01", TODAY)).map((entry) => [entry.localDate, entry.metric, entry.value]), [["2026-11-09", "STEPS", 8000]]);
    await assert.rejects(health.saveSync(me.id, [], [], NOW), { message: "HEALTH_NOT_LINKED" });
    assert.equal((await health.link(other.id, NOW)).clientId, other.id, "после отключения можно привязать другую карточку");
  } finally { await close(); }
});

test("Health: значения вне допустимых границ не записываются, ни одно из пачки", async () => {
  const { clients, health, close } = await stores();
  try {
    const me = await clients.create({ displayName: "SyntheticSelf" });
    await health.link(me.id, NOW);
    await assert.rejects(health.saveSync(me.id, [value("2026-11-09", "STEPS", 8000), value("2026-11-09", "WEIGHT_X10", 50)], ["STEPS"], NOW), { message: "HEALTH_VALUE_INVALID" });
    assert.deepEqual(await health.listDaily(me.id, "2026-11-01", TODAY), []);
  } finally { await close(); }
});

test("Health: синхронизация — шаги дня подставляются, вес и % жира переносятся только в пустые дни, ручной ввод главнее", async () => {
  const { clients, measurements, calc, health, close } = await stores();
  try {
    const me = await clients.create({ displayName: "SyntheticSelf" });
    await health.link(me.id, NOW);
    // Ручной вес за 9 ноября уже есть.
    await measurements.record(me.id, { type: "WEIGHT", valueX10: 805, localDate: "2026-11-09", localMinute: null }, NOW);
    const platform = new FakePlatform();
    platform.data = [value("2026-11-09", "STEPS", 8200), value("2026-11-10", "STEPS", 3100), value("2026-11-09", "WEIGHT_X10", 799), value("2026-11-10", "WEIGHT_X10", 798),
      value("2026-11-10", "BODY_FAT_X10", 184), value("2026-11-10", "SLEEP_MIN", 430), value("2026-11-09", "TOTAL_KCAL", 2400), value("2026-11-09", "STEPS", 250_000)];
    const outcome = await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW);
    assert.deepEqual(outcome, { kind: "SYNCED", days: 7, stepsDays: 2, importedWeight: 1, importedFat: 1 }, "250 000 шагов — вне допустимых границ, отброшено целиком");
    assert.deepEqual((await calc.listSteps(me.id, "2026-11-01", TODAY)).map((day) => [day.localDate, day.steps]), [["2026-11-09", 8200], ["2026-11-10", 3100]]);
    const journal = await measurements.listForClient(me.id);
    const weights = dailyPoints(journal.measurements, journal.primaries, "WEIGHT").map((point) => point.kind === "VALUE" ? [point.localDate, point.measurement.valueX10] : [point.localDate, null]);
    assert.deepEqual(weights, [["2026-11-09", 805], ["2026-11-10", 798]], "за 9 ноября остался ручной 80,5, за 10-е подставлен 79,8");
    const fat = dailyPoints(journal.measurements, journal.primaries, "BODY_FAT").map((point) => point.kind === "VALUE" ? point.measurement.valueX10 : null);
    assert.deepEqual(fat, [184]);
    const stored = await health.listDaily(me.id, "2026-11-01", TODAY);
    assert.equal(stored.length, 7);
    assert.ok(stored.some((entry) => entry.metric === "SLEEP_MIN" && entry.value === 430));
    assert.equal((await health.getLink())?.lastSyncAt, NOW.toISOString());
    assert.equal(platform.reads[0]?.from, "2026-08-13", "первое чтение — 90 дней");

    // Повтор: ничего не дублируется; повторное чтение — 7 дней.
    const again = await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW);
    assert.deepEqual(again, { kind: "SYNCED", days: 7, stepsDays: 0, importedWeight: 0, importedFat: 0 });
    assert.equal(platform.reads[1]?.from, "2026-11-04");
    assert.equal((await measurements.listForClient(me.id)).measurements.length, 3);

    // Тренер удалил подставленный вес — он не возвращается (день уже известен Health Connect).
    const removable = (await measurements.listForClient(me.id)).measurements.find((row) => row.type === "WEIGHT" && row.localDate === "2026-11-10")!;
    await measurements.remove(removable.id, removable.revision);
    await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW);
    assert.equal((await measurements.listForClient(me.id)).measurements.filter((row) => row.type === "WEIGHT" && row.localDate === "2026-11-10").length, 0);
    // Новое значение шагов за день заменяет прежнее (Health Connect — источник шагов).
    platform.data = [value("2026-11-10", "STEPS", 5000)];
    await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW);
    assert.equal((await calc.listSteps(me.id, TODAY, TODAY))[0]?.steps, 5000);
  } finally { await close(); }
});

test("Health: нет привязки, служба недоступна или нет разрешений — ничего не читается и не пишется", async () => {
  const { clients, measurements, calc, health, close } = await stores();
  try {
    const platform = new FakePlatform();
    assert.deepEqual(await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW), { kind: "NOT_LINKED" });
    const me = await clients.create({ displayName: "SyntheticSelf" });
    await health.link(me.id, NOW);
    platform.availabilityValue = "NOT_INSTALLED";
    assert.deepEqual(await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW), { kind: "UNAVAILABLE", availability: "NOT_INSTALLED" });
    platform.availabilityValue = "AVAILABLE";
    platform.granted = [];
    assert.deepEqual(await syncHealthConnect({ health, platform, calc, measurements, isValidHealthValue }, TODAY, NOW), { kind: "NO_PERMISSION" });
    assert.equal(platform.reads.length, 0);
    assert.equal((await health.getLink())?.lastSyncAt, null);
  } finally { await close(); }
});

test("Health: окончательное удаление клиента убирает привязку и дни; без участника — закрытый отказ", async () => {
  const gone = await stores();
  try {
    const me = await gone.clients.create({ displayName: "SyntheticSelf" });
    await gone.health.link(me.id, NOW);
    await gone.health.saveSync(me.id, [value("2026-11-09", "STEPS", 7000)], ["STEPS"], NOW);
    const archived = await gone.clients.setArchived(me.id, me.revision, true);
    const manifest = await gone.clients.previewPermanentDelete(me.id);
    assert.equal(manifest.owners.find((entry) => entry.owner === "health.connect")?.rows, 2);
    await gone.clients.deleteArchivedPermanently(me.id, archived.revision);
    assert.equal(await gone.health.getLink(), null);
    assert.equal((gone.db.prepare("SELECT count(*) AS n FROM health_daily").get() as { n: number }).n, 0);
  } finally { await gone.close(); }
  const blocked = await stores(false);
  try {
    const me = await blocked.clients.create({ displayName: "SyntheticSelf" });
    await blocked.health.link(me.id, NOW);
    const archived = await blocked.clients.setArchived(me.id, me.revision, true);
    await assert.rejects(blocked.clients.deleteArchivedPermanently(me.id, archived.revision), { message: "CLIENT_DELETION_BLOCKED" });
  } finally { await blocked.close(); }
});
