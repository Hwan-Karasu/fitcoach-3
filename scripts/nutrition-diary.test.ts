import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevNutritionDiaryRepository, devNutritionClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { devNutritionTargetsClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionTargetsRepository.ts";
import { accountedDates, isLocalDate, rankUsage, summarizeDay } from "../apps/mobile/src/features/nutrition/domain/DiaryRules.ts";
import type { FoodProduct } from "../apps/mobile/src/features/nutrition/domain/FoodModel.ts";
import { snapshotOfFood } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-10-20T10:00:00.000Z");
const DAY = "2026-10-20";

/** На 100 г: 360 ккал, Б 12,5, Ж 6,2, У 60. */
const OATS: FoodProduct = { id: "food-oats", name: "Овсянка", brand: null, unit: "G", amountX10: 1000, kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600,
  revision: 1, archivedAt: null };
/** На 100 мл: 52 ккал, Б 3, Ж 2,5, У 4,7. */
const MILK: FoodProduct = { id: "food-milk", name: "Молоко", brand: null, unit: "ML", amountX10: 1000, kcalX10: 520, proteinX10: 30, fatX10: 25, carbsX10: 47,
  revision: 1, archivedAt: null };
/** Сахар без белка и жира. */
const SUGAR: FoodProduct = { id: "food-sugar", name: "Сахар", brand: null, unit: "G", amountX10: 1000, kcalX10: 3870, proteinX10: null, fatX10: null, carbsX10: 998,
  revision: 1, archivedAt: null };

async function stores(participants = true) {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, participants ? [devNutritionClientDeletionParticipant, devNutritionTargetsClientDeletionParticipant] : []);
  await clients.initialize();
  const diary = new DevNutritionDiaryRepository(shared, WS);
  await diary.initialize();
  const close = async () => { await diary.close(); await clients.close(); };
  return { db, clients, diary, close };
}
const code = (name: string) => (error: unknown) => error instanceof Error && error.message === name;

test("N02 §49.22: сумма дня — по записям; завтрак и обед считаются отдельно", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await diary.addEntry(client.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.addEntry(client.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(MILK, 2000) }, NOW);
    const entries = await diary.listEntries(client.id, DAY, DAY);
    assert.deepEqual(entries.map((entry) => [entry.slot, entry.position, entry.snapshot.name]), [["BREAKFAST", 0, "Овсянка"], ["BREAKFAST", 1, "Молоко"]]);
    const summary = summarizeDay(DAY, entries);
    assert.equal(summary.state, "FOOD_RECORDED");
    assert.deepEqual(summary.totals, { kcalX10: 2840, proteinX10: 123, fatX10: 81, carbsX10: 394 }, "овсянка 50 г + молоко 200 мл");
    assert.deepEqual(summary.bySlot.BREAKFAST, summary.totals);
    assert.equal(summary.bySlot.LUNCH, null, "пустой приём пищи — не нулевой");
  } finally { await close(); }
});

test("N02 §49.22.2: неизвестный белок в одной записи — белок дня неизвестен, калории считаются", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await diary.addEntry(client.id, { localDate: DAY, slot: "SNACK", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.addEntry(client.id, { localDate: DAY, slot: "SNACK", snapshot: snapshotOfFood(SUGAR, 100) }, NOW);
    const totals = summarizeDay(DAY, await diary.listEntries(client.id, DAY, DAY)).totals;
    assert.equal(totals.proteinX10, null);
    assert.equal(totals.kcalX10, 1800 + 387);
  } finally { await close(); }
});

test("N02 §49.22.1: вода — отдельный факт; день только с водой не «с учётом», удаление последней еды оставляет воду", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await diary.setWater(client.id, DAY, 500, NOW);
    assert.equal(summarizeDay(DAY, await diary.listEntries(client.id, DAY, DAY)).state, "NO_FOOD", "только вода");
    assert.deepEqual(accountedDates(await diary.listEntries(client.id, DAY, DAY)), []);
    const entry = await diary.addEntry(client.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    assert.deepEqual(accountedDates(await diary.listEntries(client.id, DAY, DAY)), [DAY]);
    await diary.removeEntry(client.id, entry.id, entry.revision);
    assert.deepEqual(accountedDates(await diary.listEntries(client.id, DAY, DAY)), [], "последняя еда удалена — дата выпала из учёта");
    assert.deepEqual(await diary.listWater(client.id, DAY, DAY), [{ localDate: DAY, ml: 500 }], "вода осталась");
    await diary.setWater(client.id, DAY, 750, NOW);
    assert.deepEqual(await diary.listWater(client.id, DAY, DAY), [{ localDate: DAY, ml: 750 }], "повтор заменяет, а не дублирует");
    await diary.clearWater(client.id, DAY);
    assert.deepEqual(await diary.listWater(client.id, DAY, DAY), []);
    for (const bad of [0, -5, 20_001, 2.5]) await assert.rejects(diary.setWater(client.id, DAY, bad, NOW), code("WATER_INVALID"));
  } finally { await close(); }
});

test("N02 §49.5.2: правка количества пересчитывает запись по снимку, не по каталогу; устаревшая revision отклоняется", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const entry = await diary.addEntry(client.id, { localDate: DAY, slot: "DINNER", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    const doubled = await diary.updateQuantity(client.id, entry.id, 1, 1000, NOW);
    assert.deepEqual([doubled.revision, doubled.snapshot.quantityX10], [2, 1000]);
    assert.deepEqual(doubled.snapshot.eaten, { kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 }, "100 г по значениям снимка");
    assert.equal(doubled.snapshot.name, "Овсянка");
    await assert.rejects(diary.updateQuantity(client.id, entry.id, 1, 700, NOW), code("DIARY_STALE"));
    await assert.rejects(diary.updateQuantity(client.id, entry.id, 2, 0, NOW), code("INVALID_PORTION"));
    await assert.rejects(diary.removeEntry(client.id, entry.id, 1), code("DIARY_STALE"));
  } finally { await close(); }
});

test("N02 запись: итог из вызывающего не берётся; дата, приём пищи и количество проверяются", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const forged = { ...snapshotOfFood(OATS, 500), eaten: { kcalX10: 1, proteinX10: 1, fatX10: 1, carbsX10: 1 } };
    const saved = await diary.addEntry(client.id, { localDate: DAY, slot: "BREAKFAST", snapshot: forged }, NOW);
    assert.equal(saved.snapshot.eaten.kcalX10, 1800);
    const good = snapshotOfFood(OATS, 500);
    await assert.rejects(diary.addEntry(client.id, { localDate: "2026-02-30", slot: "LUNCH", snapshot: good }, NOW), code("DIARY_DATE_INVALID"));
    await assert.rejects(diary.addEntry(client.id, { localDate: DAY, slot: "BRUNCH" as never, snapshot: good }, NOW), code("DIARY_SLOT_INVALID"));
    await assert.rejects(diary.addEntry(client.id, { localDate: DAY, slot: "LUNCH", snapshot: { ...good, quantityX10: 0 } }, NOW), code("INVALID_PORTION"));
    await assert.rejects(diary.addEntry(client.id, { localDate: DAY, slot: "LUNCH", snapshot: { ...good, name: " " } }, NOW), code("DIARY_SNAPSHOT_INVALID"));
    assert.equal(isLocalDate("2024-02-29"), true);
    assert.equal(isLocalDate("2026-02-29"), false);
  } finally { await close(); }
});

test("N02 клиенты изолированы: записи и вода одного не видны и не правятся через другого", async () => {
  const { clients, diary, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const entry = await diary.addEntry(a.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.setWater(a.id, DAY, 300, NOW);
    assert.deepEqual(await diary.listEntries(b.id, DAY, DAY), []);
    assert.deepEqual(await diary.listWater(b.id, DAY, DAY), []);
    await assert.rejects(diary.updateQuantity(b.id, entry.id, 1, 1000, NOW), code("DIARY_STALE"));
    await assert.rejects(diary.removeEntry(b.id, entry.id, 1), code("DIARY_STALE"));
    assert.equal((await diary.listEntries(a.id, DAY, DAY)).length, 1);
  } finally { await close(); }
});

test("N02 подписка: публикуется с датой после коммита", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const seen: string[] = [];
    const off = diary.subscribeCommittedChanges((change) => seen.push(`${change.clientId}:${change.localDate}`));
    await diary.addEntry(client.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.setWater(client.id, "2026-10-19", 200, NOW);
    off();
    await diary.clearWater(client.id, "2026-10-19");
    assert.deepEqual(seen, [`${client.id}:${DAY}`, `${client.id}:2026-10-19`]);
  } finally { await close(); }
});

test("§15.7 окончательное удаление клиента убирает его дневник питания и воду, чужие не трогает; без владельца — отказ", async () => {
  const { clients, diary, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "Gone" });
    const kept = await clients.create({ displayName: "Kept" });
    await diary.addEntry(gone.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.setWater(gone.id, DAY, 300, NOW);
    await diary.addEntry(kept.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    const manifest = await clients.previewPermanentDelete(gone.id);
    assert.equal(manifest.owners.find((entry) => entry.owner === "nutrition.diary")?.rows, 2);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.deepEqual(await diary.listEntries(gone.id, DAY, DAY), []);
    assert.deepEqual(await diary.listWater(gone.id, DAY, DAY), []);
    assert.equal((await diary.listEntries(kept.id, DAY, DAY)).length, 1);
  } finally { await close(); }
  const blocked = await stores(false);
  try {
    const client = await blocked.clients.create({ displayName: "Blocked" });
    await blocked.diary.setWater(client.id, DAY, 300, NOW);
    const archived = await blocked.clients.setArchived(client.id, client.revision, true);
    await assert.rejects(blocked.clients.deleteArchivedPermanently(client.id, archived.revision), { message: "CLIENT_DELETION_BLOCKED" });
  } finally { await blocked.close(); }
});

const PREV = "2026-10-19";

test("§49.5.6: копирование приёма в пустую цель создаёт записи со снимками и не трогает источник", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await diary.addEntry(client.id, { localDate: PREV, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.addEntry(client.id, { localDate: PREV, slot: "BREAKFAST", snapshot: snapshotOfFood(MILK, 2000) }, NOW);
    await diary.addEntry(client.id, { localDate: PREV, slot: "DINNER", snapshot: snapshotOfFood(OATS, 1000) }, NOW);
    const result = await diary.copyEntries(client.id, { fromDate: PREV, toDate: DAY, slot: "BREAKFAST", targetSlot: null, mode: "APPEND" }, NOW);
    assert.deepEqual(result, { copied: 2, replaced: 0 });
    const target = await diary.listEntries(client.id, DAY, DAY);
    assert.deepEqual(target.map((entry) => [entry.slot, entry.position, entry.snapshot.name, entry.snapshot.quantityX10]),
      [["BREAKFAST", 0, "Овсянка", 500], ["BREAKFAST", 1, "Молоко", 2000]]);
    assert.equal((await diary.listEntries(client.id, PREV, PREV)).length, 3, "источник не изменился");
  } finally { await close(); }
});

test("§49.5.6: SKIP_FILLED копирует день только в пустые приёмы; повтор ничего не дублирует", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await diary.addEntry(client.id, { localDate: PREV, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.addEntry(client.id, { localDate: PREV, slot: "DINNER", snapshot: snapshotOfFood(MILK, 2000) }, NOW);
    await diary.addEntry(client.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(SUGAR, 100) }, NOW);
    const request = { fromDate: PREV, toDate: DAY, slot: null, targetSlot: null, mode: "SKIP_FILLED" } as const;
    assert.deepEqual(await diary.copyEntries(client.id, request, NOW), { copied: 1, replaced: 0 }, "завтрак цели занят — копируется только ужин");
    assert.deepEqual(await diary.copyEntries(client.id, request, NOW), { copied: 0, replaced: 0 }, "повтор безопасен");
    const target = await diary.listEntries(client.id, DAY, DAY);
    assert.deepEqual(target.map((entry) => [entry.slot, entry.snapshot.name]), [["BREAKFAST", "Сахар"], ["DINNER", "Молоко"]]);
  } finally { await close(); }
});

test("§49.5.6: REPLACE заменяет только область копирования; APPEND добавляет в конец без потерь", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await diary.addEntry(client.id, { localDate: PREV, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.addEntry(client.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(SUGAR, 100) }, NOW);
    await diary.addEntry(client.id, { localDate: DAY, slot: "DINNER", snapshot: snapshotOfFood(SUGAR, 200) }, NOW);
    await diary.copyEntries(client.id, { fromDate: PREV, toDate: DAY, slot: "LUNCH", targetSlot: null, mode: "APPEND" }, NOW);
    assert.deepEqual((await diary.listEntries(client.id, DAY, DAY)).filter((entry) => entry.slot === "LUNCH").map((entry) => [entry.position, entry.snapshot.name]),
      [[0, "Сахар"], [1, "Овсянка"]]);
    const replaced = await diary.copyEntries(client.id, { fromDate: PREV, toDate: DAY, slot: "LUNCH", targetSlot: null, mode: "REPLACE" }, NOW);
    assert.deepEqual(replaced, { copied: 1, replaced: 2 });
    const after = await diary.listEntries(client.id, DAY, DAY);
    assert.deepEqual(after.map((entry) => [entry.slot, entry.snapshot.name]), [["LUNCH", "Овсянка"], ["DINNER", "Сахар"]], "ужин не тронут");
  } finally { await close(); }
});

test("§49.5.6: копирование в другой приём, на ту же дату и несуществующий источник; клиенты изолированы", async () => {
  const { clients, diary, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    await diary.addEntry(a.id, { localDate: DAY, slot: "SNACK", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    assert.deepEqual(await diary.copyEntries(a.id, { fromDate: DAY, toDate: DAY, slot: "SNACK", targetSlot: "BREAKFAST", mode: "APPEND" }, NOW), { copied: 1, replaced: 0 });
    assert.deepEqual((await diary.listEntries(a.id, DAY, DAY)).map((entry) => entry.slot), ["BREAKFAST", "SNACK"]);
    await assert.rejects(diary.copyEntries(a.id, { fromDate: DAY, toDate: DAY, slot: "SNACK", targetSlot: null, mode: "APPEND" }, NOW), code("DIARY_COPY_SAME_TARGET"));
    await assert.rejects(diary.copyEntries(a.id, { fromDate: PREV, toDate: DAY, slot: null, targetSlot: "LUNCH", mode: "APPEND" }, NOW), code("DIARY_SLOT_INVALID"));
    assert.deepEqual(await diary.copyEntries(b.id, { fromDate: DAY, toDate: PREV, slot: null, targetSlot: null, mode: "APPEND" }, NOW), { copied: 0, replaced: 0 },
      "у клиента B нет записей: чужие данные не копируются");
    assert.equal((await diary.listEntries(b.id, PREV, PREV)).length, 0);
  } finally { await close(); }
});

test("P-21: ближайшая предыдущая дата с едой — по приёму и по дню; вода день не создаёт", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await diary.addEntry(client.id, { localDate: "2026-10-15", slot: "DINNER", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.addEntry(client.id, { localDate: "2026-10-17", slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.setWater(client.id, "2026-10-18", 500, NOW);
    assert.equal(await diary.previousFoodDate(client.id, DAY, null), "2026-10-17");
    assert.equal(await diary.previousFoodDate(client.id, DAY, "DINNER"), "2026-10-15");
    assert.equal(await diary.previousFoodDate(client.id, "2026-10-15", null), null);
  } finally { await close(); }
});

test("P-31: недавние и частые строятся из записей дневника; пустая история — пустой список", () => {
  const entry = (id: string, localDate: string, sourceId: string, kind: "FOOD" | "RECIPE" = "FOOD") => ({ id, clientId: "c", localDate, slot: "LUNCH" as const, position: 0, revision: 1,
    snapshot: { ...snapshotOfFood(OATS, 500), source: { kind, id: sourceId } } });
  const entries = [entry("1", "2026-10-10", "a"), entry("2", "2026-10-11", "b"), entry("3", "2026-10-12", "a"), entry("4", "2026-10-12", "c"), entry("5", "2026-10-13", "b", "RECIPE")];
  assert.deepEqual(rankUsage(entries, "recent", 10).map((item) => `${item.kind}:${item.id}`), ["RECIPE:b", "FOOD:c", "FOOD:a", "FOOD:b"], "по последней дате, при равной — по порядку записи");
  assert.deepEqual(rankUsage(entries, "frequent", 2).map((item) => [item.id, item.count]), [["a", 2], ["b", 1]], "частота, затем свежесть; лимит 2");
  assert.deepEqual(rankUsage([], "recent", 10), []);
});
