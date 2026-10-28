import assert from "node:assert/strict";
import test from "node:test";
import { assignSlotKeys } from "../apps/mobile/src/features/training/plans/domain/SlotKeys.ts";

// BUILDER-SLOTS: карточки конструктора переиспользуются при смене недели; ключ слота остаётся у карточки, пока она есть на экране.
const counter = () => { let n = 0; return () => `k${n++}`; };

test("первое назначение: уникальные ключи по порядку", () => {
  assert.deepEqual([...assignSlotKeys(new Map(), ["a", "b", "c"], counter())], [["a", "k0"], ["b", "k1"], ["c", "k2"]]);
});

test("смена недели: новые id занимают освободившиеся ключи по порядку, лишних ключей не создаётся", () => {
  const next = (() => { const fresh = counter(); const first = assignSlotKeys(new Map(), ["a", "b", "c"], fresh); return assignSlotKeys(first, ["x", "y", "z"], fresh); })();
  assert.deepEqual([...next], [["x", "k0"], ["y", "k1"], ["z", "k2"]]);
});

test("в новой неделе упражнений больше — ключи добавляются, меньше — лишние освобождаются", () => {
  const fresh = counter();
  const three = assignSlotKeys(new Map(), ["a", "b", "c"], fresh);
  assert.deepEqual([...assignSlotKeys(three, ["x", "y", "z", "w"], fresh)].map(([, key]) => key), ["k0", "k1", "k2", "k3"]);
  assert.deepEqual([...assignSlotKeys(three, ["x"], fresh)], [["x", "k0"]]);
});

test("тот же состав и порядок не меняет ключей; перестановка (перетаскивание) оставляет ключ за упражнением", () => {
  const fresh = counter();
  const first = assignSlotKeys(new Map(), ["a", "b", "c"], fresh);
  assert.deepEqual([...assignSlotKeys(first, ["a", "b", "c"], fresh)], [...first]);
  const reordered = assignSlotKeys(first, ["c", "a", "b"], fresh);
  assert.equal(reordered.get("a"), "k0");
  assert.equal(reordered.get("c"), "k2");
});

test("добавление и удаление упражнения не трогает ключи остальных", () => {
  const fresh = counter();
  const first = assignSlotKeys(new Map(), ["a", "b", "c"], fresh);
  const added = assignSlotKeys(first, ["a", "b", "c", "d"], fresh);
  assert.deepEqual([added.get("a"), added.get("b"), added.get("c"), added.get("d")], ["k0", "k1", "k2", "k3"]);
  const removed = assignSlotKeys(added, ["a", "c", "d"], fresh);
  assert.deepEqual([removed.get("a"), removed.get("c"), removed.get("d")], ["k0", "k2", "k3"]);
});
