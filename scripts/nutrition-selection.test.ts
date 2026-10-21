import assert from "node:assert/strict";
import test from "node:test";
import type { FoodProduct } from "../apps/mobile/src/features/nutrition/domain/FoodModel.ts";
import { snapshotOfFood } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { planBatch } from "../apps/mobile/src/features/nutrition/domain/SelectionRules.ts";
import { pickSnapshot, usageSuggestions } from "../apps/mobile/src/features/nutrition/domain/CatalogPick.ts";
import { browseRecipes, EMPTY_RECIPE_FILTERS } from "../apps/mobile/src/features/nutrition/domain/RecipeBrowse.ts";
import type { DiaryEntry } from "../apps/mobile/src/features/nutrition/domain/DiaryModel.ts";
import type { Recipe } from "../apps/mobile/src/features/nutrition/domain/RecipeModel.ts";
import { savedSnapshot } from "../apps/mobile/src/features/nutrition/domain/SavedMeal.ts";

const food = (id: string, name: string): FoodProduct => ({ id, name, brand: null, unit: "G", amountX10: 1000, kcalX10: 1000, proteinX10: 100, fatX10: 100, carbsX10: 100, revision: 1, archivedAt: null });
const picks = [{ key: "f:a", snapshot: snapshotOfFood(food("a", "Овсянка"), 500) }, { key: "f:b", snapshot: snapshotOfFood(food("b", "Молоко"), 2000) }, { key: "f:c", snapshot: snapshotOfFood(food("c", "Яйцо"), 600) }];

test("порция: десятичная запятая, штуки, повторный выбор и недопустимый черновик", () => {
  const item = { kind: "FOOD" as const, food: { ...food("egg", "Яйцо"), gramsPerPieceX10: 550 } };
  assert.equal(pickSnapshot(item, { mode: "PIECES", recipeUnit: "PORTION", text: "1,5" }).quantityX10, 825);
  assert.equal(pickSnapshot(item, { mode: "BASIS", recipeUnit: "PORTION", text: "130" }).quantityX10, 1300);
  for (const text of ["", "abc", "0", "-1", "1,234", "999999999999"]) {
    assert.throws(() => pickSnapshot(item, { mode: "BASIS", recipeUnit: "PORTION", text }), Error, text);
  }
  assert.throws(() => pickSnapshot({ ...item, food: { ...item.food, gramsPerPieceX10: null } }, { mode: "PIECES", recipeUnit: "PORTION", text: "1" }), /PIECE_MASS_UNKNOWN/u);
});

const entry = (id: string, localDate: string, slot: DiaryEntry["slot"], quantityX10: number): DiaryEntry => ({ id, clientId: "synthetic-client", localDate, slot, position: 0, revision: 1,
  snapshot: snapshotOfFood(food(id, id), quantityX10), override: null });
test("недавние сгруппированы по целевому слоту; частые по количеству, историческая масса не теряется", () => {
  const rows = [entry("a", "2026-10-19", "BREAKFAST", 1300), entry("b", "2026-10-20", "LUNCH", 700), entry("a", "2026-10-20", "LUNCH", 900)];
  const recent = usageSuggestions(rows, "BREAKFAST", "recent", 50);
  assert.deepEqual(recent.map((row) => [row.id, row.sameSlot, row.snapshot.quantityX10]), [["a", true, 1300], ["b", false, 700]]);
  assert.equal(usageSuggestions(rows, "BREAKFAST", "frequent", 50)[0]!.count, 2);
  const suggested = pickSnapshot({ kind: "FOOD", food: food("a", "a"), suggested: recent[0]!.snapshot });
  assert.equal(suggested.quantityX10, 1300);
});

const recipe = (id: string, kcalX10: number | null, minutes: number | null, day: number): Recipe => ({ id, name: id, revision: 1, archivedAt: null, servingsX10: 10, cookedMassX10: 1000,
  createdAt: `2026-10-${day}T00:00:00Z`, ingredients: [{ food: { ...food(id, id), kcalX10 }, quantityX10: 1000 }],
  details: { prepMinutes: minutes, cookMinutes: 0, categories: [], steps: [], photoUri: null } });
test("рецепты: границы калорий/времени, unknown и явный ноль, сортировка без мутации", () => {
  const rows = [recipe("c", 2500, 30, 21), recipe("b", 1000, 15, 20), recipe("a", 0, 0, 19), recipe("z", null, null, 18)];
  assert.deepEqual(browseRecipes(rows, EMPTY_RECIPE_FILTERS, "KCAL_DESC").map((item) => item.id), ["c", "b", "a", "z"]);
  assert.deepEqual(browseRecipes(rows, EMPTY_RECIPE_FILTERS, "OLDEST").map((item) => item.id), ["z", "a", "b", "c"]);
  assert.deepEqual(browseRecipes(rows, { ...EMPTY_RECIPE_FILTERS, calories: "100_250" }, "DEFAULT").map((item) => item.id), ["b"]);
  assert.deepEqual(browseRecipes(rows, { ...EMPTY_RECIPE_FILTERS, time: "UNDER_15" }, "DEFAULT").map((item) => item.id), ["a"]);
  assert.deepEqual(browseRecipes(rows, { ...EMPTY_RECIPE_FILTERS, time: "30_60" }, "DEFAULT").map((item) => item.id), ["c"]);
  assert.deepEqual(rows.map((item) => item.id), ["c", "b", "a", "z"]);
});
test("рецепты: доли макроэнергии по 4/9/4, неизвестный БЖУ исключён только активным фильтром", () => {
  const high = recipe("high", 100, 0, 20);
  const unknown = { ...high, id: "unknown", ingredients: [{ ...high.ingredients[0]!, food: { ...high.ingredients[0]!.food, proteinX10: null } }] };
  const filters = { ...EMPTY_RECIPE_FILTERS, macros: { ...EMPTY_RECIPE_FILTERS.macros, protein: { min: 20, max: 30 } } };
  assert.equal(browseRecipes([high, unknown], EMPTY_RECIPE_FILTERS, "DEFAULT").length, 2);
  assert.deepEqual(browseRecipes([high, unknown], filters, "DEFAULT").map((item) => item.id), ["high"]);
});
test("набор фиксирует локальный override без изменения оригинала; пересчёт массы после сохранения", () => {
  const original = entry("a", "2026-10-20", "BREAKFAST", 1000);
  const changed = { ...original, override: { baseQuantityX10: 1000, values: { kcalX10: 800, proteinX10: 0, fatX10: null, carbsX10: null } },
    snapshot: { ...original.snapshot, eaten: { ...original.snapshot.eaten, kcalX10: 800, proteinX10: 0 } } };
  const frozen = savedSnapshot(changed);
  assert.equal(frozen.perBasis.kcalX10, 800);
  assert.equal(frozen.perBasis.proteinX10, 0);
  assert.equal(original.snapshot.perBasis.kcalX10, 1000);
});

test("NUT-FS-22/24: N позиций × M приёмов = K записей; порядок — по приёмам, внутри приёма — как выбрано", () => {
  const plan = planBatch("2026-10-20", picks, ["LUNCH", "BREAKFAST"]);
  assert.deepEqual([plan.items, plan.slots, plan.total], [3, 2, 6]);
  assert.deepEqual(plan.entries.map((entry) => [entry.slot, entry.snapshot.name]), [["BREAKFAST", "Овсянка"], ["BREAKFAST", "Молоко"], ["BREAKFAST", "Яйцо"], ["LUNCH", "Овсянка"], ["LUNCH", "Молоко"], ["LUNCH", "Яйцо"]],
    "порядок приёмов — как в дневнике, а не как нажато");
  assert.ok(plan.entries.every((entry) => entry.localDate === "2026-10-20"));
  assert.equal(plan.needsConfirmation, true, "M > 1 — подтверждение дублирования");
  assert.equal(plan.summary, "3 позиции × 2 приёма = 6 записей");
});

test("NUT-FS-24: один приём не требует подтверждения; повтор слота и пустой выбор не плодят записи", () => {
  const one = planBatch("2026-10-20", picks.slice(0, 1), ["SNACK", "SNACK"]);
  assert.deepEqual([one.items, one.slots, one.total, one.needsConfirmation], [1, 1, 1, false], "дубль слота схлопывается");
  assert.equal(one.summary, "1 позиция × 1 приём = 1 запись");
  const empty = planBatch("2026-10-20", [], ["LUNCH"]);
  assert.deepEqual([empty.total, empty.entries.length], [0, 0]);
  const duplicated = planBatch("2026-10-20", [picks[0]!, picks[0]!], ["LUNCH"]);
  assert.equal(duplicated.items, 1, "одна и та же позиция дважды в выборе — одна запись");
  assert.equal(planBatch("2026-10-20", picks, []).total, 0, "приёмов нет — записывать некуда");
});
