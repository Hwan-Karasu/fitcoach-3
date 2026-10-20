import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevFoodCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevFoodCatalogRepository.ts";
import { DevRecipeCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevRecipeCatalogRepository.ts";
import type { FoodInput } from "../apps/mobile/src/features/nutrition/domain/FoodModel.ts";
import { snapshotOfFood, snapshotOfRecipe } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { recipeBases, recipeTotals, validateRecipe } from "../apps/mobile/src/features/nutrition/domain/RecipeRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-10-20T10:00:00.000Z");

/** На 100 г: ккал 360, Б 12,5, Ж 6,2, У 60. */
const OATS: FoodInput = { name: "Овсянка", brand: null, unit: "G", amountX10: 1000, kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 };
/** На 100 мл: ккал 52, Б 3, Ж 2,5, У 4,7. */
const MILK: FoodInput = { name: "Молоко", brand: null, unit: "ML", amountX10: 1000, kcalX10: 520, proteinX10: 30, fatX10: 25, carbsX10: 47 };

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const foods = new DevFoodCatalogRepository(shared, WS);
  const recipes = new DevRecipeCatalogRepository(shared, WS);
  await foods.initialize();
  await recipes.initialize();
  const oats = await foods.create(OATS, NOW);
  const milk = await foods.create(MILK, NOW);
  const close = async () => { await recipes.close(); await foods.close(); };
  return { db, foods, recipes, oats, milk, close };
}
const code = (name: string) => (error: unknown) => error instanceof Error && error.message === name;

/** Каша: овсянка 50 г + молоко 200 мл; 2 порции; готовое блюдо 400 г. */
const porridge = (oatsId: string, milkId: string) => ({ name: "Каша", servingsX10: 20, cookedMassX10: 4000,
  ingredients: [{ foodId: oatsId, quantityX10: 500 }, { foodId: milkId, quantityX10: 2000 }] });

test("N01 §49.4.2: итог рецепта — сумма ингредиентов; порция и 100 г считаются от массы готового блюда", async () => {
  const { recipes, oats, milk, close } = await stores();
  try {
    const recipe = await recipes.create(porridge(oats.id, milk.id), NOW);
    // Овсянка 50 г: 180 ккал, Б 6,3 (6,25 округлено), Ж 3,1, У 30; молоко 200 мл: 104 ккал, Б 6, Ж 5, У 9,4.
    assert.deepEqual(recipeTotals(recipe), { kcalX10: 2840, proteinX10: 123, fatX10: 81, carbsX10: 394 });
    const [portion, hundred] = recipeBases(recipe);
    assert.deepEqual(portion, { basis: { unit: "PORTION", amountX10: 10 }, nutrients: { kcalX10: 1420, proteinX10: 62, fatX10: 41, carbsX10: 197 } });
    assert.deepEqual(hundred, { basis: { unit: "G", amountX10: 1000 }, nutrients: { kcalX10: 710, proteinX10: 31, fatX10: 20, carbsX10: 99 } });
  } finally { await close(); }
});

test("N01 §49.4.3: без массы готового блюда граммов нет — масса не выдумывается по сырому весу", async () => {
  const { recipes, oats, milk, close } = await stores();
  try {
    const recipe = await recipes.create({ ...porridge(oats.id, milk.id), cookedMassX10: null }, NOW);
    assert.deepEqual(recipeBases(recipe).map((item) => item.basis.unit), ["PORTION"]);
    assert.throws(() => snapshotOfRecipe(recipe, "G", 2000), code("INVALID_PORTION"));
  } finally { await close(); }
});

test("N01 §49.3.2: ингредиент без белка делает белок рецепта неизвестным, а не 0", async () => {
  const { foods, recipes, oats, close } = await stores();
  try {
    const sugar = await foods.create({ name: "Сахар", brand: null, unit: "G", amountX10: 1000, kcalX10: 3870, proteinX10: null, fatX10: null, carbsX10: 998 }, NOW);
    const recipe = await recipes.create({ name: "Сладкая каша", servingsX10: 10, cookedMassX10: null,
      ingredients: [{ foodId: oats.id, quantityX10: 1000 }, { foodId: sugar.id, quantityX10: 100 }] }, NOW);
    const totals = recipeTotals(recipe);
    assert.equal(totals.proteinX10, null);
    assert.equal(totals.kcalX10, 3600 + 387, "калории известны у обоих — сумма есть");
  } finally { await close(); }
});

test("N01 §49.5: снимок порции не меняется от правки продукта и рецепта; сумма дня не удваивает ингредиенты", async () => {
  const { foods, recipes, oats, milk, close } = await stores();
  try {
    const recipe = await recipes.create(porridge(oats.id, milk.id), NOW);
    const snapshot = snapshotOfRecipe(recipe, "PORTION", 15);
    assert.deepEqual(snapshot.eaten, { kcalX10: 2130, proteinX10: 93, fatX10: 62, carbsX10: 296 }, "1,5 порции: 1420×1,5 ккал и т.д.");
    assert.deepEqual(snapshot.source, { kind: "RECIPE", id: recipe.id });
    assert.deepEqual(snapshot.ingredients.map((item) => item.name), ["Овсянка", "Молоко"], "состав — справка");

    const food = snapshotOfFood(oats, 500);
    assert.deepEqual(food.eaten, { kcalX10: 1800, proteinX10: 63, fatX10: 31, carbsX10: 300 });
    const before = JSON.stringify([snapshot, food]);

    await foods.update(oats.id, 1, { ...OATS, kcalX10: 100 }, NOW);
    await recipes.update(recipe.id, 1, { ...porridge(oats.id, milk.id), name: "Каша новая", servingsX10: 10 }, NOW);
    await foods.archive(milk.id, 1, NOW);
    assert.equal(JSON.stringify([snapshot, food]), before, "ранее сохранённый снимок неизменяем");
    const reloaded = await recipes.get(recipe.id);
    assert.notEqual(recipeTotals(reloaded!).kcalX10, 2840, "новое использование считается по новым значениям");
  } finally { await close(); }
});

test("N01 рецепты: проверка ввода, состав без повторов и скрытых новых продуктов, правка по revision, скрытие", async () => {
  const { foods, recipes, oats, milk, close } = await stores();
  try {
    const base = porridge(oats.id, milk.id);
    assert.throws(() => validateRecipe({ ...base, name: " " }), code("RECIPE_NAME_INVALID"));
    assert.throws(() => validateRecipe({ ...base, servingsX10: 0 }), code("RECIPE_SERVINGS_INVALID"));
    assert.throws(() => validateRecipe({ ...base, cookedMassX10: 0 }), code("RECIPE_MASS_INVALID"));
    assert.throws(() => validateRecipe({ ...base, ingredients: [] }), code("RECIPE_INGREDIENT_INVALID"));
    assert.throws(() => validateRecipe({ ...base, ingredients: [base.ingredients[0]!, base.ingredients[0]!] }), code("RECIPE_INGREDIENT_INVALID"));
    assert.throws(() => validateRecipe({ ...base, ingredients: [{ foodId: oats.id, quantityX10: 0 }] }), code("RECIPE_INGREDIENT_INVALID"));
    await assert.rejects(recipes.create({ ...base, ingredients: [{ foodId: "missing", quantityX10: 100 }] }, NOW), code("FOOD_SOURCE_UNAVAILABLE"));

    const recipe = await recipes.create(base, NOW);
    await foods.archive(milk.id, 1, NOW);
    const kept = await recipes.update(recipe.id, 1, { ...base, name: "Каша 2" }, NOW);
    assert.deepEqual([kept.name, kept.revision, kept.ingredients.length], ["Каша 2", 2, 2], "скрытый продукт, уже бывший в рецепте, остаётся");
    await assert.rejects(recipes.create({ ...base, name: "Другая" }, NOW), code("FOOD_SOURCE_UNAVAILABLE"), "новый рецепт со скрытым продуктом нельзя");
    await assert.rejects(recipes.update(recipe.id, 1, base, NOW), code("RECIPE_STALE"));

    assert.deepEqual((await recipes.search("каш")).map((item) => item.id), [recipe.id]);
    const hidden = await recipes.archive(recipe.id, 2, NOW);
    assert.notEqual(hidden.archivedAt, null);
    assert.deepEqual(await recipes.search(), []);
    assert.equal((await recipes.get(recipe.id))?.ingredients.length, 2, "скрытый рецепт читается по id вместе с составом");
    assert.equal((await recipes.archive(recipe.id, 2, NOW)).revision, hidden.revision);
  } finally { await close(); }
});

test("N01 схема: ингредиент нельзя удалить из каталога физически, пока он в рецепте", async () => {
  const { db, recipes, oats, milk, close } = await stores();
  try {
    await recipes.create(porridge(oats.id, milk.id), NOW);
    assert.throws(() => db.prepare("DELETE FROM dev_food_products WHERE id = ?").run(oats.id), /FOREIGN KEY/u);
  } finally { await close(); }
});
