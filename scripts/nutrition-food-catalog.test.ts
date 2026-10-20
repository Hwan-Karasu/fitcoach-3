import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevFoodCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevFoodCatalogRepository.ts";
import type { FoodInput } from "../apps/mobile/src/features/nutrition/domain/FoodModel.ts";
import { gramsFromPieces, parseDecimalX10, piecesFromGrams, scaleNutrients, validateFood } from "../apps/mobile/src/features/nutrition/domain/FoodRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-10-20T10:00:00.000Z");

/** Овсянка на 100 г: 360 ккал, Б 12,5, Ж 6,2, У 60 (литералы из примера, не пересчёт кодом). */
const OATS: FoodInput = { name: "Овсянка", brand: null, unit: "G", amountX10: 1000, kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 };

async function store() {
  const db = new DatabaseSync(":memory:");
  const repository = new DevFoodCatalogRepository(new SharedSqliteDatabase(async () => nodeSqlitePort(db)), WS);
  await repository.initialize();
  return { db, repository };
}
const code = (name: string) => (error: unknown) => error instanceof Error && error.message === name;

test("N01 §49.3.3: пересчёт на фактическое количество; неизвестный нутриент остаётся null, а не 0", () => {
  assert.deepEqual(scaleNutrients(OATS, 500), { kcalX10: 1800, proteinX10: 63, fatX10: 31, carbsX10: 300 }, "50 г из 100 г: половина значений, 6,25 → 6,3 г");
  const partial = scaleNutrients({ ...OATS, proteinX10: null }, 2000);
  assert.equal(partial.proteinX10, null, "белок не вводили — после пересчёта не ноль");
  assert.equal(partial.kcalX10, 7200);
  for (const bad of [0, -10, 5.5, Number.NaN]) assert.throws(() => scaleNutrients(OATS, bad), code("INVALID_PORTION"));
});

test("N01 ввод: названия, основа и нутриенты проверяются; продукт без значений отклоняется", () => {
  assert.equal(validateFood({ ...OATS, name: "  Овсянка   хлопья ", brand: "  " }).name, "Овсянка хлопья");
  assert.equal(validateFood({ ...OATS, brand: "  " }).brand, null);
  assert.throws(() => validateFood({ ...OATS, name: "   " }), code("FOOD_NAME_INVALID"));
  assert.throws(() => validateFood({ ...OATS, amountX10: 0 }), code("FOOD_BASIS_INVALID"));
  assert.throws(() => validateFood({ ...OATS, fatX10: -1 }), code("FOOD_NUTRIENT_INVALID"));
  assert.throws(() => validateFood({ ...OATS, kcalX10: null, proteinX10: null, fatX10: null, carbsX10: null }), code("FOOD_NUTRIENTS_EMPTY"));
  assert.equal(validateFood({ ...OATS, kcalX10: null, proteinX10: 0, fatX10: null, carbsX10: null }).proteinX10, 0, "явный ноль — допустимое значение");
});

test("N01 разбор числа: запятая и точка; пусто, минус, два знака и буквы — null", () => {
  assert.equal(parseDecimalX10("12,5"), 125);
  assert.equal(parseDecimalX10(" 100 "), 1000);
  for (const bad of ["", "-1", "1,25", "abc", "1,2,3"]) assert.equal(parseDecimalX10(bad), null);
});

test("N01 каталог: создание, поиск по-русски без регистра, правка по revision, скрытие вместо удаления", async () => {
  const { repository } = await store();
  try {
    const oats = await repository.create(OATS, NOW);
    const milk = await repository.create({ name: "Молоко", brand: "Простоквашино", unit: "ML", amountX10: 1000, kcalX10: 520, proteinX10: 30, fatX10: 25, carbsX10: 47 }, NOW);
    assert.deepEqual([oats.revision, oats.archivedAt], [1, null]);
    assert.deepEqual((await repository.search()).map((item) => item.name), ["Молоко", "Овсянка"], "по алфавиту");
    assert.deepEqual((await repository.search("ОВСЯ")).map((item) => item.id), [oats.id]);
    assert.deepEqual((await repository.search("простокв")).map((item) => item.id), [milk.id], "поиск и по марке");

    const renamed = await repository.update(oats.id, 1, { ...OATS, name: "Овсяные хлопья" }, NOW);
    assert.deepEqual([renamed.name, renamed.revision, renamed.kcalX10], ["Овсяные хлопья", 2, 3600]);
    await assert.rejects(repository.update(oats.id, 1, OATS, NOW), code("FOOD_STALE"), "устаревшая revision");

    const hidden = await repository.archive(oats.id, 2, NOW);
    assert.notEqual(hidden.archivedAt, null);
    assert.deepEqual((await repository.search()).map((item) => item.id), [milk.id], "из активного каталога пропал");
    assert.equal((await repository.get(oats.id))?.name, "Овсяные хлопья", "история по id по-прежнему читает скрытый продукт");
    assert.equal((await repository.archive(oats.id, 2, NOW)).revision, hidden.revision, "повторное скрытие безопасно");
    await assert.rejects(repository.update(oats.id, hidden.revision, OATS, NOW), code("FOOD_STALE"), "скрытый продукт не правится");
    await assert.rejects(repository.archive("missing", 1, NOW), code("FOOD_STALE"));
  } finally { await repository.close(); }
});

test("N01 подписка: публикуется после коммита, отписка работает", async () => {
  const { repository } = await store();
  try {
    const seen: string[] = [];
    const off = repository.subscribeCommittedChanges((change) => seen.push(change.foodId));
    const created = await repository.create(OATS, NOW);
    off();
    await repository.update(created.id, 1, { ...OATS, name: "Овсянка 2" }, NOW);
    assert.deepEqual(seen, [created.id]);
  } finally { await repository.close(); }
});

test("N01 схема: CHECK не пускает продукт без значений и отрицательные числа", async () => {
  const { db, repository } = await store();
  try {
    const insert = (kcal: number | null, protein: number | null) => db.prepare(`INSERT INTO dev_food_products (id, workspace_id, name, basis_unit,
      basis_amount_x10, kcal_x10, protein_x10, revision, created_at, updated_at) VALUES ('x', 'w', 'Х', 'G', 1000, ?, ?, 1, 'c', 'c')`).run(kcal, protein);
    assert.throws(() => insert(null, null), /CHECK/u);
    assert.throws(() => insert(-1, null), /CHECK/u);
    insert(null, 0);
  } finally { await repository.close(); }
});

test("P-28: граммы ↔ штуки только при известной массе штуки; неизвестная масса — отказ, не ноль", () => {
  assert.equal(gramsFromPieces(20, 450), 900, "2 шт × 45 г = 90 г");
  assert.equal(piecesFromGrams(900, 450), 20, "90 г при 45 г в штуке = 2 шт");
  assert.equal(gramsFromPieces(15, 450), 675, "1,5 шт × 45 г = 67,5 г");
  assert.throws(() => gramsFromPieces(20, null), code("PIECE_MASS_UNKNOWN"));
  assert.throws(() => piecesFromGrams(900, undefined), code("PIECE_MASS_UNKNOWN"));
  assert.throws(() => gramsFromPieces(0, 450), code("INVALID_PORTION"));
});

test("P-27/P-28 ввод: штрихкод и масса штуки проверяются; пустое — null", () => {
  const valid = validateFood({ ...OATS, barcode: " 4601234567890 ", gramsPerPieceX10: 450 });
  assert.equal(valid.barcode, "4601234567890");
  assert.equal(valid.gramsPerPieceX10, 450);
  assert.equal(validateFood({ ...OATS, barcode: "  " }).barcode, null);
  assert.equal(validateFood(OATS).gramsPerPieceX10, null);
  assert.throws(() => validateFood({ ...OATS, barcode: "12" }), code("FOOD_BARCODE_INVALID"));
  assert.throws(() => validateFood({ ...OATS, barcode: "ab cd" }), code("FOOD_BARCODE_INVALID"));
  assert.throws(() => validateFood({ ...OATS, gramsPerPieceX10: 0 }), code("FOOD_PIECE_MASS_INVALID"));
});

test("P-27/P-30: штрихкод и масса штуки сохраняются и находятся поиском; избранное — флаг без смены revision", async () => {
  const { repository } = await store();
  const created = await repository.create({ ...OATS, barcode: "4601234567890", gramsPerPieceX10: 450 }, NOW);
  assert.equal(created.barcode, "4601234567890");
  assert.equal(created.gramsPerPieceX10, 450);
  assert.equal(created.favorite, false);
  assert.deepEqual((await repository.search("4601234")).map((food) => food.id), [created.id], "локальный поиск по штрихкоду");
  const plain = await repository.create({ ...OATS, name: "Рис" }, NOW);
  assert.equal(plain.barcode, null);
  assert.equal(plain.gramsPerPieceX10, null, "масса штуки не придумывается");

  const starred = await repository.setFavorite(created.id, true, NOW);
  assert.equal(starred.favorite, true);
  assert.equal(starred.revision, created.revision, "флаг не меняет значения продукта");
  assert.deepEqual((await repository.search("", "FAVORITES")).map((food) => food.id), [created.id]);
  assert.equal((await repository.search("")).length, 2);
  assert.equal((await repository.setFavorite(created.id, false, NOW)).favorite, false);
  assert.deepEqual(await repository.search("", "FAVORITES"), []);
  await assert.rejects(repository.setFavorite("no-such-food", true, NOW), code("FOOD_STALE"));
});

test("P-30: правка продукта не сбрасывает избранное; скрытый продукт из избранного исчезает, но читается по id", async () => {
  const { repository } = await store();
  const created = await repository.create(OATS, NOW);
  await repository.setFavorite(created.id, true, NOW);
  const edited = await repository.update(created.id, created.revision, { ...OATS, name: "Овсянка 2", barcode: "99999", gramsPerPieceX10: 300 }, NOW);
  assert.equal(edited.favorite, true);
  assert.equal(edited.barcode, "99999");
  await repository.archive(created.id, edited.revision, NOW);
  assert.deepEqual(await repository.search("", "FAVORITES"), []);
  assert.equal((await repository.get(created.id))?.favorite, true, "история и карточка читают скрытый продукт");
});
