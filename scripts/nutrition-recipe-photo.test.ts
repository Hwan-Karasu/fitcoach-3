import assert from "node:assert/strict";
import test from "node:test";
import { photosToDiscard } from "../apps/mobile/src/features/nutrition/domain/RecipePhotoRules.ts";

const OLD = "file:///docs/local-images/old.jpg";
const A = "file:///docs/local-images/a.jpg";
const B = "file:///docs/local-images/b.jpg";

test("NUT-019 отмена редактора удаляет все выбранные копии, но не сохранённое ранее фото", () => {
  assert.deepEqual(photosToDiscard({ picked: [A, B], previous: OLD, current: B, saved: false }), [A, B]);
  assert.deepEqual(photosToDiscard({ picked: [], previous: OLD, current: OLD, saved: false }), []);
});

test("NUT-019 запись с заменой: удаляются старое фото и промежуточные копии, итоговое остаётся", () => {
  assert.deepEqual([...photosToDiscard({ picked: [A, B], previous: OLD, current: B, saved: true })].sort(), [A, OLD]);
});

test("NUT-019 запись без изменения фото ничего не удаляет; «Убрать фото» удаляет прежнее", () => {
  assert.deepEqual(photosToDiscard({ picked: [], previous: OLD, current: OLD, saved: true }), []);
  assert.deepEqual(photosToDiscard({ picked: [], previous: OLD, current: null, saved: true }), [OLD]);
  assert.deepEqual(photosToDiscard({ picked: [A], previous: null, current: A, saved: true }), []);
});
