import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { devNutritionCalcClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionCalcRepository.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevNutritionDiaryRepository, devNutritionClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { devNutritionTargetsClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionTargetsRepository.ts";
import { usageSuggestions } from "../apps/mobile/src/features/nutrition/domain/CatalogPick.ts";
import { accountedDates, isLocalDate, rankUsage, summarizeDay, sumNutrients } from "../apps/mobile/src/features/nutrition/domain/DiaryRules.ts";
import type { DiaryEntry, MealSlot } from "../apps/mobile/src/features/nutrition/domain/DiaryModel.ts";
import type { FoodProduct, Nutrients } from "../apps/mobile/src/features/nutrition/domain/FoodModel.ts";
import { snapshotOfFood } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { devNutritionCatalog, DEV_NUTRITION_LEDGER } from "../apps/mobile/src/features/nutrition/data/DevNutritionCatalog.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";

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
  const clients = new DevClientRepository(shared, WS, participants ? [devNutritionClientDeletionParticipant, devNutritionTargetsClientDeletionParticipant, devNutritionCalcClientDeletionParticipant] : []);
  await clients.initialize();
  const diary = new DevNutritionDiaryRepository(shared, WS);
  await diary.initialize();
  const close = async () => { await diary.close(); await clients.close(); };
  return { db, clients, diary, close };
}
const code = (name: string) => (error: unknown) => error instanceof Error && error.message === name;
/** Единственный путь правки записи — `editEntry`; не названные поля берутся из самой записи (`override: null` сохраняет прежнюю правку). */
const edit = (diary: DevNutritionDiaryRepository, clientId: string, entry: DiaryEntry, revision: number,
  patch: Readonly<{ quantityX10?: number; slot?: MealSlot; override?: Nutrients | "CLEAR" | null }> = {}) =>
  diary.editEntry(clientId, entry.id, revision, { quantityX10: patch.quantityX10 ?? entry.snapshot.quantityX10, slot: patch.slot ?? entry.slot, override: patch.override ?? null }, NOW);

test("batch receipt: одновременное/повторное подтверждение идемпотентно, чужой клиент независим, иной payload отклонён", async () => {
  const { clients, diary, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticBatchA" });
    const b = await clients.create({ displayName: "SyntheticBatchB" });
    const inputs = [{ localDate: DAY, slot: "BREAKFAST" as const, snapshot: snapshotOfFood(OATS, 500) }, { localDate: DAY, slot: "LUNCH" as const, snapshot: snapshotOfFood(MILK, 700) }];
    let events = 0; diary.subscribeCommittedChanges(() => { events += 1; });
    const [first, replay] = await Promise.all([diary.addEntries(a.id, inputs, NOW, "synthetic-command"), diary.addEntries(a.id, inputs, NOW, "synthetic-command")]);
    assert.deepEqual(replay, first); assert.equal(events, 1);
    assert.equal((await diary.listEntries(a.id, DAY, DAY)).length, 2);
    await assert.rejects(diary.addEntries(a.id, inputs.slice(0, 1), NOW, "synthetic-command"), code("DIARY_COMMAND_REUSED"));
    await diary.addEntries(b.id, inputs, NOW, "synthetic-command");
    assert.equal((await diary.listEntries(b.id, DAY, DAY)).length, 2);
    await diary.removeEntry(a.id, first[0]!.id, first[0]!.revision);
    assert.deepEqual(await diary.addEntries(a.id, inputs, NOW, "synthetic-command"), first);
    assert.equal((await diary.listEntries(a.id, DAY, DAY)).length, 1, "повтор команды не восстанавливает удалённый факт");
    const archived = await clients.setArchived(a.id, a.revision, true);
    await clients.deleteArchivedPermanently(a.id, archived.revision);
  } finally { await close(); }
});

test("миграции v10→v14: старый ноль/null и override сохраняются, повторный запуск не меняет данные", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const client = await clients.create({ displayName: "SyntheticV10" });
  const writer = new WriterCoordinator(nodeSqlitePort(db));
  await runMigrations(writer, devNutritionCatalog.filter((migration) => migration.version <= 10), DEV_NUTRITION_LEDGER);
  db.prepare(`INSERT INTO dev_food_diary_entries (id,workspace_id,client_id,local_date,slot,position,source_kind,source_id,name,brand,basis_unit,basis_amount_x10,
    per_kcal_x10,per_protein_x10,per_fat_x10,per_carbs_x10,quantity_x10,ingredients_json,revision,created_at,updated_at,override_base_quantity_x10,override_kcal_x10)
    VALUES ('old-entry',?,?,'2026-10-20','BREAKFAST',0,'FOOD','old-food','Old',NULL,'G',1000,0,NULL,0,100,500,'[]',3,'x','x',500,10)`).run(WS, client.id);
  const diary = new DevNutritionDiaryRepository(shared, WS);
  await diary.initialize();
  try {
    const [old] = await diary.listEntries(client.id, DAY, DAY);
    assert.equal(old?.revision, 3); assert.equal(old?.snapshot.perBasis.kcalX10, 0); assert.equal(old?.snapshot.eaten.kcalX10, 10);
    assert.equal(old?.snapshot.eaten.proteinX10, null);
    const meal = await diary.createSavedMeal(client.id, { name: "Old copy", snapshots: [old!.snapshot] });
    await diary.rememberSearchQuery(client.id, "Old");
    await runMigrations(writer, devNutritionCatalog, DEV_NUTRITION_LEDGER);
    assert.deepEqual(await diary.listEntries(client.id, DAY, DAY), [old]);
    assert.deepEqual(await diary.listSavedMeals(client.id), [meal]);
    assert.deepEqual(await diary.listSearchQueries(client.id), ["Old"]);
    assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
  } finally { await diary.close(); await clients.close(); }
});

test("история запросов: клиентская изоляция, dedup, последнее использование, предел 12, отдельно от еды", async () => {
  const { clients, diary, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticQueries" });
    const b = await clients.create({ displayName: "SyntheticQueriesOther" });
    await diary.rememberSearchQuery(a.id, " Творог   нежный ");
    await diary.rememberSearchQuery(a.id, "творог нежный");
    assert.deepEqual(await diary.listSearchQueries(a.id), ["творог нежный"]);
    assert.deepEqual(await diary.listSearchQueries(b.id), []);
    for (let i = 0; i < 15; i += 1) await diary.rememberSearchQuery(a.id, `Продукт ${i}`);
    const history = await diary.listSearchQueries(a.id);
    assert.equal(history.length, 12); assert.equal(history[0], "Продукт 14");
    assert.deepEqual(await diary.listEntries(a.id, DAY, DAY), []);
    const archived = await clients.setArchived(a.id, 1, true);
    await clients.deleteArchivedPermanently(a.id, archived.revision);
    assert.deepEqual(await diary.listSearchQueries(a.id), []);
  } finally { await close(); }
});

test("N02: редактор атомарен: масса + override + перенос, один event; отказ SQLite оставляет прежнюю запись", async () => {
  const { db, clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticAtomic" });
    const other = await clients.create({ displayName: "SyntheticOther" });
    const entry = await diary.addEntry(client.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) });
    let events = 0;
    diary.subscribeCommittedChanges(() => { events += 1; });
    const input = { quantityX10: 1500, slot: "DINNER" as const, override: { kcalX10: 1230, proteinX10: 0, fatX10: null, carbsX10: null } };
    db.exec("CREATE TRIGGER synthetic_fail BEFORE UPDATE ON dev_food_diary_entries WHEN NEW.slot = 'DINNER' BEGIN SELECT RAISE(ABORT, 'synthetic-failure'); END");
    await assert.rejects(diary.editEntry(client.id, entry.id, entry.revision, input), /synthetic-failure/u);
    assert.deepEqual((await diary.listEntries(client.id, DAY, DAY))[0], entry);
    assert.equal(events, 0);
    db.exec("DROP TRIGGER synthetic_fail");
    await assert.rejects(diary.editEntry(other.id, entry.id, entry.revision, input), code("DIARY_STALE"));
    const updated = await diary.editEntry(client.id, entry.id, entry.revision, input);
    assert.equal(updated.revision, entry.revision + 1);
    assert.equal(updated.slot, "DINNER");
    assert.equal(updated.snapshot.quantityX10, 1500);
    assert.equal(updated.snapshot.eaten.kcalX10, 1230);
    assert.equal(updated.snapshot.eaten.proteinX10, 0);
    assert.equal(events, 1);
    await assert.rejects(diary.editEntry(client.id, entry.id, entry.revision, input), code("DIARY_STALE"));
    const cleared = await diary.editEntry(client.id, entry.id, updated.revision, { ...input, override: "CLEAR" });
    assert.equal(cleared.override, null);
    assert.equal(cleared.snapshot.eaten.kcalX10, 5400);
  } finally { await close(); }
});

test("N01: сохранённая еда изолирована по клиенту, CAS, batch, повторное чтение и удаление клиента", async () => {
  const { clients, diary, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticMealA" });
    const b = await clients.create({ displayName: "SyntheticMealB" });
    const snapshots = [snapshotOfFood(OATS, 500), snapshotOfFood(SUGAR, 100)];
    let notifications = 0;
    diary.subscribeSavedMealChanges(() => { notifications += 1; });
    const meal = await diary.createSavedMeal(a.id, { name: "  Завтрак   дома ", snapshots });
    assert.equal(meal.name, "Завтрак дома");
    assert.deepEqual(await diary.listSavedMeals(b.id), []);
    await assert.rejects(diary.updateSavedMeal(b.id, meal.id, 1, meal), code("SAVED_MEAL_STALE"));
    await assert.rejects(diary.removeSavedMeal(b.id, meal.id, 1), code("SAVED_MEAL_STALE"));
    const edited = await diary.updateSavedMeal(a.id, meal.id, 1, { name: "Обед", snapshots: snapshots.slice(0, 1) });
    assert.equal(edited.revision, 2);
    await assert.rejects(diary.updateSavedMeal(a.id, meal.id, 1, meal), code("SAVED_MEAL_STALE"));
    assert.deepEqual(await diary.listSavedMeals(a.id), [edited]);
    await diary.addEntries(a.id, edited.snapshots.map((snapshot) => ({ localDate: DAY, slot: "LUNCH", snapshot })));
    await diary.removeSavedMeal(a.id, edited.id, 2);
    assert.equal((await diary.listEntries(a.id, DAY, DAY)).length, 1, "удаление набора не меняет историю");
    assert.equal(notifications, 3);
    await diary.createSavedMeal(b.id, { name: "Чужой", snapshots });
    await diary.createSavedMeal(a.id, { name: "Удаляемый", snapshots });
    const archived = await clients.setArchived(a.id, a.revision, true);
    await clients.deleteArchivedPermanently(a.id, archived.revision);
    assert.deepEqual(await diary.listSavedMeals(a.id), []);
    assert.equal((await diary.listSavedMeals(b.id)).length, 1);
    await assert.rejects(diary.createSavedMeal(b.id, { name: "", snapshots }), code("SAVED_MEAL_NAME_INVALID"));
    await assert.rejects(diary.createSavedMeal(b.id, { name: "Пусто", snapshots: [] }), code("SAVED_MEAL_ITEMS_INVALID"));
  } finally { await close(); }
});

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

test("NUT-UX-PARITY-01: неизвестный белок в одной записи считается нулём (как в 2.0), калории суммируются", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await diary.addEntry(client.id, { localDate: DAY, slot: "SNACK", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.addEntry(client.id, { localDate: DAY, slot: "SNACK", snapshot: snapshotOfFood(SUGAR, 100) }, NOW);
    const totals = summarizeDay(DAY, await diary.listEntries(client.id, DAY, DAY)).totals;
    assert.equal(totals.proteinX10, 63, "белок только от овсянки: 50 г × 12,5 г/100 г");
    assert.equal(totals.kcalX10, 1800 + 387);
  } finally { await close(); }
});

test("NUT-UX-PARITY-01: продукт без калорий, но с Б/Ж/У — калории досчитываются 4/9/4 в приёме и дне", () => {
  const eaten = { kcalX10: null, proteinX10: 100, fatX10: 50, carbsX10: 200 };
  assert.equal(sumNutrients([eaten]).kcalX10, 1650, "10 г Б, 5 г Ж, 20 г У → 165 ккал");
  assert.equal(sumNutrients([eaten, { kcalX10: 1000, proteinX10: null, fatX10: null, carbsX10: null }]).kcalX10, 2650);
  assert.equal(sumNutrients([eaten, { kcalX10: 1000, proteinX10: null, fatX10: null, carbsX10: null }]).fatX10, 50, "неизвестные жиры второй записи — ноль");
  assert.deepEqual(sumNutrients([{ kcalX10: null, proteinX10: null, fatX10: null, carbsX10: null }]), { kcalX10: null, proteinX10: null, fatX10: null, carbsX10: null });
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
    const doubled = await edit(diary, client.id, entry, 1, { quantityX10: 1000 });
    assert.deepEqual([doubled.revision, doubled.snapshot.quantityX10], [2, 1000]);
    assert.deepEqual(doubled.snapshot.eaten, { kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 }, "100 г по значениям снимка");
    assert.equal(doubled.snapshot.name, "Овсянка");
    await assert.rejects(edit(diary, client.id, entry, 1, { quantityX10: 700 }), code("DIARY_STALE"));
    await assert.rejects(edit(diary, client.id, entry, 2, { quantityX10: 0 }), code("INVALID_PORTION"));
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
    await assert.rejects(edit(diary, b.id, entry, 1, { quantityX10: 1000 }), code("DIARY_STALE"));
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

test("P-29: одна позиция в несколько приёмов — одной транзакцией; ошибка в списке не оставляет частичной записи", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const snapshot = snapshotOfFood(OATS, 500);
    const added = await diary.addEntries(client.id, [{ localDate: DAY, slot: "BREAKFAST", snapshot }, { localDate: DAY, slot: "SNACK", snapshot }], NOW);
    assert.deepEqual(added.map((entry) => [entry.slot, entry.position, entry.snapshot.quantityX10]), [["BREAKFAST", 0, 500], ["SNACK", 0, 500]]);
    assert.deepEqual((await diary.listEntries(client.id, DAY, DAY)).map((entry) => entry.slot), ["BREAKFAST", "SNACK"]);
    await assert.rejects(diary.addEntries(client.id, [{ localDate: DAY, slot: "LUNCH", snapshot }, { localDate: "2026-02-31", slot: "DINNER", snapshot }], NOW),
      code("DIARY_DATE_INVALID"));
    assert.equal((await diary.listEntries(client.id, DAY, DAY)).length, 2, "обед не записан: операция откатилась целиком");
    assert.deepEqual(await diary.addEntries(client.id, [], NOW), []);
  } finally { await close(); }
});

test("NUT-FS-31: запись переносится в другой приём той же даты — без дубля, в конец приёма, снимок и количество прежние, revision растёт; чужая запись и устаревшая revision отклоняются", async () => {
  const { clients, diary, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const oats = await diary.addEntry(a.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    await diary.addEntry(a.id, { localDate: DAY, slot: "SNACK", snapshot: snapshotOfFood(MILK, 2000) }, NOW);
    const moved = await edit(diary, a.id, oats, oats.revision, { slot: "SNACK" });
    assert.deepEqual([moved.slot, moved.position, moved.revision, moved.snapshot.quantityX10, moved.snapshot.name], ["SNACK", 1, oats.revision + 1, 500, "Овсянка"]);
    const day = await diary.listEntries(a.id, DAY, DAY);
    assert.deepEqual(day.map((entry) => [entry.slot, entry.snapshot.name]), [["SNACK", "Молоко"], ["SNACK", "Овсянка"]], "в старом приёме записи нет, дубля нет");
    assert.deepEqual(summarizeDay(DAY, day).totals, summarizeDay(DAY, [oats, ...day.filter((entry) => entry.id !== oats.id)]).totals, "итог дня не изменился");
    await assert.rejects(edit(diary, a.id, moved, oats.revision, { slot: "DINNER" }), code("DIARY_STALE"), "устаревшая revision");
    await assert.rejects(edit(diary, b.id, moved, moved.revision, { slot: "DINNER" }), code("DIARY_STALE"), "запись другого клиента");
    await assert.rejects(edit(diary, a.id, moved, moved.revision, { slot: "LATE" as never }), code("DIARY_SLOT_INVALID"));
  } finally { await close(); }
});

test("NUT-FS-27…30, 33: ручная правка К/Б/Ж/У только у одной записи; пропорционально масштабируется с массой; «вернуть значения каталога» снимает", async () => {
  const { clients, diary, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const mine = await diary.addEntry(a.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    const twin = await diary.addEntry(a.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    const other = await diary.addEntry(b.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    assert.equal(mine.override ?? null, null);
    assert.deepEqual(mine.snapshot.eaten, { kcalX10: 1800, proteinX10: 63, fatX10: 31, carbsX10: 300 }, "50 г овсянки по каталогу");

    const edited = await edit(diary, a.id, mine, mine.revision, { override: { kcalX10: 2000, proteinX10: null, fatX10: null, carbsX10: 250 } });
    assert.deepEqual(edited.snapshot.eaten, { kcalX10: 2000, proteinX10: 63, fatX10: 31, carbsX10: 250 }, "изменены только калории и углеводы, остальное — по каталогу");
    assert.deepEqual(edited.catalogEaten, { kcalX10: 1800, proteinX10: 63, fatX10: 31, carbsX10: 300 }, "значения каталога доступны для «Вернуть»");
    assert.deepEqual(edited.override, { baseQuantityX10: 500, values: { kcalX10: 2000, proteinX10: null, fatX10: null, carbsX10: 250 } });
    assert.equal(edited.revision, mine.revision + 1);
    assert.deepEqual(edited.snapshot.perBasis, mine.snapshot.perBasis, "снимок продукта не переписан");

    const day = await diary.listEntries(a.id, DAY, DAY);
    assert.deepEqual(day.find((entry) => entry.id === twin.id)?.snapshot.eaten, twin.snapshot.eaten, "соседняя запись того же продукта не изменилась");
    assert.deepEqual((await diary.listEntries(b.id, DAY, DAY))[0]?.snapshot.eaten, other.snapshot.eaten, "запись другого клиента не изменилась");
    assert.equal(summarizeDay(DAY, day).totals.kcalX10, 2000 + 1800, "итог дня считается по значениям записи");

    const doubled = await edit(diary, a.id, mine, edited.revision, { quantityX10: 1000 });
    assert.deepEqual(doubled.snapshot.eaten, { kcalX10: 4000, proteinX10: 125, fatX10: 62, carbsX10: 500 }, "масса ×2 — правка масштабируется пропорционально: 2000→4000, 250→500");
    assert.deepEqual(doubled.catalogEaten, { kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 });

    const reset = await edit(diary, a.id, doubled, doubled.revision, { override: "CLEAR" });
    assert.equal(reset.override ?? null, null);
    assert.deepEqual(reset.snapshot.eaten, { kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 }, "значения каталога на текущую массу");
    await assert.rejects(edit(diary, a.id, doubled, doubled.revision, { override: "CLEAR" }), code("DIARY_STALE"));
  } finally { await close(); }
});

test("NUT-FS-34: правка проверяется — пустая, отрицательная и нечисловая отклоняются; явный ноль допустим; чужая запись и устаревшая revision не правятся", async () => {
  const { clients, diary, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const entry = await diary.addEntry(a.id, { localDate: DAY, slot: "SNACK", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    const none = { kcalX10: null, proteinX10: null, fatX10: null, carbsX10: null };
    await assert.rejects(edit(diary, a.id, entry, entry.revision, { override: none }), code("DIARY_OVERRIDE_INVALID"), "ничего не задано — это не правка");
    await assert.rejects(edit(diary, a.id, entry, entry.revision, { override: { ...none, kcalX10: -1 } }), code("DIARY_OVERRIDE_INVALID"));
    await assert.rejects(edit(diary, a.id, entry, entry.revision, { override: { ...none, kcalX10: 1.5 } }), code("DIARY_OVERRIDE_INVALID"));
    await assert.rejects(edit(diary, b.id, entry, entry.revision, { override: { ...none, kcalX10: 100 } }), code("DIARY_STALE"), "чужая запись");
    await assert.rejects(edit(diary, a.id, entry, entry.revision + 5, { override: { ...none, kcalX10: 100 } }), code("DIARY_STALE"));
    const zero = await edit(diary, a.id, entry, entry.revision, { override: { ...none, fatX10: 0 } });
    assert.equal(zero.snapshot.eaten.fatX10, 0, "явный ноль — осознанное значение, а не «нет данных»");
    assert.equal(zero.snapshot.eaten.kcalX10, 1800, "не тронутое остаётся по каталогу");
    const unknown = await diary.addEntry(a.id, { localDate: DAY, slot: "SNACK", snapshot: snapshotOfFood({ ...OATS, proteinX10: null }, 500) }, NOW);
    const patched = await edit(diary, a.id, unknown, unknown.revision, { override: { ...none, kcalX10: 900 } });
    assert.equal(patched.snapshot.eaten.proteinX10, null, "неизвестный белок остаётся неизвестным, не нулём");
  } finally { await close(); }
});

test("NUT-FS-33, 41: правка записи копируется вместе с приёмом и сохраняется при переносе в другой приём", async () => {
  const { clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const entry = await diary.addEntry(client.id, { localDate: PREV, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    const edited = await edit(diary, client.id, entry, entry.revision, { override: { kcalX10: 2000, proteinX10: null, fatX10: null, carbsX10: null } });
    await diary.copyEntries(client.id, { fromDate: PREV, toDate: DAY, slot: "BREAKFAST", targetSlot: null, mode: "APPEND" }, NOW);
    const copy = (await diary.listEntries(client.id, DAY, DAY))[0]!;
    assert.deepEqual(copy.snapshot.eaten, edited.snapshot.eaten, "копия переносит фактическое значение, а не пересчитывает по каталогу");
    const moved = await edit(diary, client.id, copy, copy.revision, { slot: "DINNER" });
    assert.equal(moved.snapshot.eaten.kcalX10, 2000);
  } finally { await close(); }
});

test("NUT-003: правка записи с копиями в другие приёмы — одна транзакция и одно событие; копия наследует правку как есть", async () => {
  const { db, clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticCopies" });
    const entry = await diary.addEntry(client.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(OATS, 500) });
    let events = 0;
    diary.subscribeCommittedChanges(() => { events += 1; });
    const input = { quantityX10: 1000, slot: "BREAKFAST" as const, override: { kcalX10: null, proteinX10: 500, fatX10: null, carbsX10: null }, copyToSlots: ["LUNCH", "DINNER"] as const };
    db.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON dev_food_diary_entries WHEN NEW.slot = 'DINNER' BEGIN SELECT RAISE(ABORT, 'synthetic-failure'); END");
    await assert.rejects(diary.editEntry(client.id, entry.id, entry.revision, input), /synthetic-failure/u);
    assert.deepEqual(await diary.listEntries(client.id, DAY, DAY), [entry], "правки и копий нет");
    assert.equal(events, 0);
    db.exec("DROP TRIGGER synthetic_fail");
    const updated = await diary.editEntry(client.id, entry.id, entry.revision, input);
    assert.equal(events, 1);
    const rows = await diary.listEntries(client.id, DAY, DAY);
    assert.deepEqual(rows.map((row) => row.slot), ["BREAKFAST", "LUNCH", "DINNER"]);
    for (const copy of rows.slice(1)) {
      assert.equal(copy.snapshot.quantityX10, 1000);
      assert.deepEqual(copy.override, updated.override, "правлен только белок, как у оригинала");
      assert.equal(copy.snapshot.eaten.proteinX10, 500);
      assert.equal(copy.snapshot.eaten.kcalX10, 3600, "калории по каталогу, не зафиксированы правкой");
    }
  } finally { await close(); }
});

test("аудит NUT-009: чтение «Недавних/Частых» берёт только записи нужных позиций, а результат тот же, что по всему дневнику", async () => {
  const { db, clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticUsage" });
    const foods = Array.from({ length: 8 }, (_, index) => ({ ...OATS, id: `food-${index}`, name: `Еда ${index}` }));
    // Повторы разной частоты и даты, в том числе совпадающие по последней дате и по числу использований (границы среза).
    const plan: [number, string, "BREAKFAST" | "LUNCH"][] = [[0, "2026-10-01", "BREAKFAST"], [1, "2026-10-02", "LUNCH"], [1, "2026-10-03", "BREAKFAST"], [2, "2026-10-03", "LUNCH"],
      [3, "2026-10-04", "BREAKFAST"], [3, "2026-10-04", "LUNCH"], [4, "2026-10-04", "LUNCH"], [5, "2026-10-05", "BREAKFAST"], [6, "2026-10-05", "LUNCH"],
      [6, "2026-10-06", "LUNCH"], [7, "2026-10-06", "BREAKFAST"], [0, "2026-10-07", "BREAKFAST"], [2, "2026-10-08", "LUNCH"]];
    for (const [index, date, slot] of plan) await diary.addEntry(client.id, { localDate: date, slot, snapshot: snapshotOfFood(foods[index]!, 500) }, NOW);
    await diary.addEntry(client.id, { localDate: "2026-12-31", slot: "LUNCH", snapshot: snapshotOfFood(foods[7]!, 500) }, NOW);
    const all = await diary.listEntries(client.id, "0001-01-01", "2026-10-20");
    for (const order of ["recent", "frequent"] as const) {
      for (const limit of [1, 3, 5, 50]) {
        const reduced = await diary.listUsageEntries(client.id, order, limit, "2026-10-20");
        const expected = usageSuggestions(all, "BREAKFAST", order, limit).map((item) => [item.kind, item.id, item.count, item.slot, item.sameSlot]);
        assert.deepEqual(usageSuggestions(reduced, "BREAKFAST", order, limit).map((item) => [item.kind, item.id, item.count, item.slot, item.sameSlot]), expected, `${order} ×${limit}`);
        if (limit <= 3) assert.ok(reduced.length < all.length, `${order} ×${limit}: прочитано меньше записей, чем в дневнике`);
      }
    }
    assert.equal((await diary.listUsageEntries(client.id, "recent", 50, "2026-10-20")).some((entry) => entry.localDate === "2026-12-31"), false, "будущие даты не входят");
    void db;
  } finally { await close(); }
});

test("аудит NUT-008: квитанции пакетной записи ограничены последними 50 на клиента; повтор свежей команды идемпотентен", async () => {
  const { db, clients, diary, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticReceipts" });
    const other = await clients.create({ displayName: "SyntheticOtherReceipts" });
    const input = (index: number) => [{ localDate: DAY, slot: "SNACK" as const, snapshot: snapshotOfFood(OATS, 100 + index) }];
    await diary.addEntries(other.id, input(0), NOW, "other-1");
    for (let index = 0; index < 60; index += 1) await diary.addEntries(client.id, input(index), NOW, `cmd-${index}`);
    const count = (id: string) => (db.prepare("SELECT count(*) AS n FROM dev_nutrition_batch_commands WHERE client_id = ?").get(id) as { n: number }).n;
    assert.equal(count(client.id), 50);
    assert.equal(count(other.id), 1, "квитанции другого клиента не затронуты");
    const before = (await diary.listEntries(client.id, DAY, DAY)).length;
    await diary.addEntries(client.id, input(59), NOW, "cmd-59");
    assert.equal((await diary.listEntries(client.id, DAY, DAY)).length, before, "повтор свежей команды не дублирует записи");
  } finally { await close(); }
});
