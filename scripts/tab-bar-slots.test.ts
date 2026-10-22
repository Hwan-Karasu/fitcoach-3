import assert from "node:assert/strict";
import test from "node:test";
import { focusedLeafKey } from "../apps/mobile/src/app/navigation/focusedLeafKey.ts";
import { createSlotStore, PENDING, resolveSlot } from "../apps/mobile/src/shared/ui/components/slotStore.ts";

// Нижняя панель навигации: какой экран сейчас в фокусе и что он положил в панель (стрелки недель, строка переключателя).

test("focusedLeafKey: спускается по вкладке и стеку до экрана в фокусе", () => {
  const state = {
    index: 2,
    routes: [
      { key: "home-1" },
      { key: "nutrition-1" },
      { key: "training-tab", state: { index: 1, routes: [{ key: "program-9" }, { key: "workout-4" }] } },
    ],
  };
  assert.equal(focusedLeafKey(state), "workout-4");
});

test("focusedLeafKey: вложенного состояния ещё нет — ключ самой вкладки", () => {
  assert.equal(focusedLeafKey({ index: 0, routes: [{ key: "home-1" }, { key: "training-tab" }] }), "home-1");
});

test("focusedLeafKey: у неполного состояния без index в фокусе последний экран", () => {
  const state = { index: 0, routes: [{ key: "training-tab", state: { routes: [{ key: "index-1" }, { key: "program-2" }] } }] };
  assert.equal(focusedLeafKey(state), "program-2");
});

test("focusedLeafKey: у вложенного экрана нет ключа — ничего не показываем, а не ключ вкладки", () => {
  const state = { index: 0, routes: [{ key: "training-tab", state: { index: 0, routes: [{}] } }] };
  assert.equal(focusedLeafKey(state), undefined);
});

test("слоты: значение экрана читается по его ключу, чужой ключ пуст", () => {
  const store = createSlotStore<string>();
  store.set("program-9", "стрелки программы");
  store.set("workout-4", "стрелки дневника");
  assert.equal(store.get("program-9"), "стрелки программы");
  assert.equal(store.get("workout-4"), "стрелки дневника");
  assert.equal(store.get("other"), undefined);
});

test("слоты: прежний экран остаётся записанным, пока он жив, — переход не оставляет панель пустой", () => {
  const store = createSlotStore<string>();
  store.set("program-9", "стрелки программы");
  store.set("workout-4", "стрелки дневника");
  // экран тренировки в фокусе, программа под ним не размонтирована: её запись цела
  assert.equal(store.get("program-9"), "стрелки программы");
  store.remove("workout-4");
  assert.equal(store.get("workout-4"), undefined);
  assert.equal(store.get("program-9"), "стрелки программы");
});

test("слоты: подписчики уведомляются при записи и снятии, а повтор того же значения — нет", () => {
  const store = createSlotStore<string>();
  let notifications = 0;
  const off = store.subscribe(() => { notifications += 1; });
  store.set("a", "x");
  store.set("a", "x");
  store.set("a", "y");
  store.remove("a");
  store.remove("a");
  assert.equal(notifications, 3);
  off();
  store.set("a", "z");
  assert.equal(notifications, 3);
});

test("слоты: снимок меняется при записи и стабилен без неё (для useSyncExternalStore)", () => {
  const store = createSlotStore<string>();
  const first = store.getSnapshot();
  assert.equal(store.getSnapshot(), first);
  store.set("a", "x");
  assert.notEqual(store.getSnapshot(), first);
  const second = store.getSnapshot();
  assert.equal(store.getSnapshot(), second);
});

// Экран, который скоро положит содержимое в панель, объявляет это заранее («ожидается»): пока оно не готово, панель не пустеет.

test("слот в ожидании: панель держит то, что показывала до перехода", () => {
  assert.equal(resolveSlot<string>(PENDING, "стрелки программы"), "стрелки программы");
  assert.equal(resolveSlot<string>(PENDING, undefined), undefined);
});

test("слот готов: показывается его значение; явная пустота убирает прежнее", () => {
  assert.equal(resolveSlot<string>("стрелки дневника", "стрелки программы"), "стрелки дневника");
  assert.equal(resolveSlot<string>(null, "стрелки программы"), undefined);
});

test("слот не объявлен: экран ничего в панель не кладёт — прежнее не тянется за ним", () => {
  assert.equal(resolveSlot<string>(undefined, "стрелки программы"), undefined);
});
