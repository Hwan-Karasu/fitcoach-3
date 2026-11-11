import assert from "node:assert/strict";
import test from "node:test";
import { choiceRows } from "../apps/mobile/src/features/nutrition/domain/RecipeBrowse.ts";

// Ожидаемые ряды — с макета владельца (скриншот 4): «Любые» на всю ширину, остальные четыре — 2 ряда × 2 колонки.
test("UIX-FIT-12: 1 + 4 варианта — первый отдельным рядом, остальные два ряда по два", () => {
  assert.deepEqual(choiceRows(["Любые", "Менее 100", "100–250", "250–500", "Более 500"]),
    [["Любые"], ["Менее 100", "100–250"], ["250–500", "Более 500"]]);
});

test("UIX-FIT-12: нечётный остаток — последний ряд из одного варианта; один вариант и пустой список", () => {
  assert.deepEqual(choiceRows([1, 2, 3, 4]), [[1], [2, 3], [4]]);
  assert.deepEqual(choiceRows([1]), [[1]]);
  assert.deepEqual(choiceRows([]), []);
});
