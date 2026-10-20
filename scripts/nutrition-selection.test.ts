import assert from "node:assert/strict";
import test from "node:test";
import type { FoodProduct } from "../apps/mobile/src/features/nutrition/domain/FoodModel.ts";
import { snapshotOfFood } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { planBatch } from "../apps/mobile/src/features/nutrition/domain/SelectionRules.ts";

const food = (id: string, name: string): FoodProduct => ({ id, name, brand: null, unit: "G", amountX10: 1000, kcalX10: 1000, proteinX10: 100, fatX10: 100, carbsX10: 100, revision: 1, archivedAt: null });
const picks = [{ key: "f:a", snapshot: snapshotOfFood(food("a", "Овсянка"), 500) }, { key: "f:b", snapshot: snapshotOfFood(food("b", "Молоко"), 2000) }, { key: "f:c", snapshot: snapshotOfFood(food("c", "Яйцо"), 600) }];

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
