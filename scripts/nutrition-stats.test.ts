import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevNutritionDiaryRepository } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import type { DiaryEntry } from "../apps/mobile/src/features/nutrition/domain/DiaryModel.ts";
import type { FoodProduct, Nutrients } from "../apps/mobile/src/features/nutrition/domain/FoodModel.ts";
import { snapshotOfFood } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { computeNutritionStats } from "../apps/mobile/src/features/nutrition/domain/NutritionStats.ts";
import type { Corridors, TargetVersion } from "../apps/mobile/src/features/nutrition/domain/TargetModel.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-10-20T10:00:00.000Z");

const none: Nutrients = { kcalX10: null, proteinX10: null, fatX10: null, carbsX10: null };
let n = 0;
/** Пищевая запись с заданными итогами «съедено» (ккал и белок в целых единицах, остальное неизвестно). */
function entry(localDate: string, kcal: number | null, protein: number | null = null): DiaryEntry {
  n += 1;
  const eaten: Nutrients = { ...none, kcalX10: kcal === null ? null : kcal * 10, proteinX10: protein === null ? null : protein * 10 };
  return { id: `e${n}`, clientId: "c", localDate, slot: "LUNCH", position: n, revision: 1,
    snapshot: { source: { kind: "FOOD", id: "f" }, name: "Еда", brand: null, basis: { unit: "G", amountX10: 1000 }, perBasis: eaten, quantityX10: 1000, eaten, ingredients: [] } };
}
const range = (min: number, max: number) => ({ minX10: min * 10, maxX10: max * 10 });
const corridors = (kcal: [number, number] | null, protein: [number, number] | null = null): Corridors =>
  ({ kcal: kcal === null ? null : range(...kcal), protein: protein === null ? null : range(...protein), fat: null, carbs: null });
const everyDay = (effectiveFrom: string, day: Corridors): TargetVersion => ({ id: "v", clientId: "c", effectiveFrom, revision: 1, days: Array(7).fill(day) });

test("N04 §49.22.2: две даты с записями 450 и 2100 ккал в неделе — среднее 1275 за 2 дня, а не за 7", () => {
  const stats = computeNutritionStats({ from: "2026-10-19", to: "2026-10-25", versions: [], exceptions: [],
    entries: [entry("2026-10-20", 450), entry("2026-10-23", 2100)] });
  assert.equal(stats.periodDays, 7);
  assert.equal(stats.accountedDays, 2);
  assert.equal(stats.metrics.kcal.averageX10, 12750);
  assert.equal(stats.metrics.kcal.daysWithValue, 2);
  assert.equal(stats.metrics.kcal.hitPercentX10, null, "целей нет — «—», а не 0 %");
  assert.equal(stats.days.filter((day) => day.accounted).length, 2);
  assert.equal(stats.days[0]?.valuesX10.kcal, null, "пустой день — не 0 ккал");
});

test("N04 §49.22.2: 10 дат с едой, у 8 есть цель; 5 из 8 в коридоре → 62,5 %", () => {
  // Версия с 07.10: 05 и 06.10 без цели (исключены из сравнения, но входят в среднее). Значения 07–11.10 в коридоре 1900–2100, 12–14.10 вне.
  const values: [string, number][] = [["2026-10-05", 1500], ["2026-10-06", 1500], ["2026-10-07", 2000], ["2026-10-08", 1900], ["2026-10-09", 2100],
    ["2026-10-10", 2000], ["2026-10-11", 2050], ["2026-10-12", 1800], ["2026-10-13", 2500], ["2026-10-14", 1899]];
  const stats = computeNutritionStats({ from: "2026-10-05", to: "2026-10-14", versions: [everyDay("2026-10-07", corridors([1900, 2100]))], exceptions: [],
    entries: values.map(([date, kcal]) => entry(date, kcal)) });
  const kcal = stats.metrics.kcal;
  assert.deepEqual([stats.accountedDays, kcal.compared, kcal.inRange, kcal.below, kcal.above], [10, 8, 5, 2, 1]);
  assert.equal(kcal.hitPercentX10, 625);
  assert.equal(kcal.daysWithValue, 10);
});

test("N04 §49.22.2: неизвестный белок в день — день не участвует в белке, но участвует в калориях", () => {
  const stats = computeNutritionStats({ from: "2026-10-19", to: "2026-10-20", exceptions: [],
    versions: [everyDay("2026-10-01", corridors([1900, 2100], [140, 160]))],
    entries: [entry("2026-10-19", 2000, 150), entry("2026-10-20", 2000, null)] });
  assert.deepEqual([stats.metrics.kcal.compared, stats.metrics.kcal.inRange], [2, 2]);
  assert.deepEqual([stats.metrics.protein.compared, stats.metrics.protein.inRange, stats.metrics.protein.daysWithValue], [1, 1, 1]);
  assert.equal(stats.metrics.protein.averageX10, 1500, "среднее по одному известному дню — 150 г");
  assert.equal(stats.days[1]?.verdicts.protein, "UNKNOWN");
});

test("N04: период без единой записи — «нет данных», а не нули; исключение даты и история целей учитываются по датам", () => {
  const empty = computeNutritionStats({ from: "2026-10-19", to: "2026-10-21", versions: [], exceptions: [], entries: [] });
  assert.deepEqual([empty.accountedDays, empty.metrics.kcal.averageX10, empty.metrics.kcal.compared], [0, null, 0]);

  const stats = computeNutritionStats({ from: "2026-10-14", to: "2026-10-15",
    versions: [everyDay("2026-10-01", corridors([2000, 2200])), { ...everyDay("2026-10-15", corridors([1800, 1900])), id: "v2" }],
    exceptions: [{ clientId: "c", localDate: "2026-10-14", corridors: corridors([2600, 2800]) }],
    entries: [entry("2026-10-14", 2100), entry("2026-10-15", 2100)] });
  assert.deepEqual(stats.days.map((day) => [day.targetSource, day.verdicts.kcal]), [["EXCEPTION", "BELOW"], ["SCHEDULE", "ABOVE"]],
    "14.10 — по исключению (2100 ниже 2600), 15.10 — по версии B (2100 выше 1900)");
});

test("N04 §49.22.1.7: вода не создаёт учёт, удаление последней еды выводит дату из статистики", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const diary = new DevNutritionDiaryRepository(shared, WS);
  await diary.initialize();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const oats: FoodProduct = { id: "oats", name: "Овсянка", brand: null, unit: "G", amountX10: 1000, kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600, revision: 1, archivedAt: null };
    const period = { from: "2026-10-19", to: "2026-10-21", versions: [], exceptions: [] };
    await diary.setWater(client.id, "2026-10-20", 500, NOW);
    assert.equal(computeNutritionStats({ ...period, entries: await diary.listEntries(client.id, period.from, period.to) }).accountedDays, 0, "только вода");
    const eaten = await diary.addEntry(client.id, { localDate: "2026-10-20", slot: "LUNCH", snapshot: snapshotOfFood(oats, 500) }, NOW);
    const withFood = computeNutritionStats({ ...period, entries: await diary.listEntries(client.id, period.from, period.to) });
    assert.deepEqual([withFood.accountedDays, withFood.metrics.kcal.averageX10], [1, 1800], "50 г овсянки: 180 ккал");
    await diary.removeEntry(client.id, eaten.id, eaten.revision);
    assert.equal(computeNutritionStats({ ...period, entries: await diary.listEntries(client.id, period.from, period.to) }).accountedDays, 0);
  } finally { await diary.close(); await clients.close(); }
});

test("N04 период: обратный или слишком длинный диапазон отклоняется", () => {
  const base = { versions: [], exceptions: [], entries: [] };
  assert.throws(() => computeNutritionStats({ ...base, from: "2026-10-20", to: "2026-10-19" }), { message: "STATS_PERIOD_INVALID" });
  assert.throws(() => computeNutritionStats({ ...base, from: "2000-01-01", to: "2026-10-19" }), { message: "STATS_PERIOD_INVALID" });
});
