import assert from "node:assert/strict";
import test from "node:test";
import { diaryDateChip } from "../src/features/training/execution/domain/DiaryDate.ts";

// Чип даты в шапке дневника: неизвестная дата не должна быть длиннее статуса «Не начата», иначе строка переносится и шапка «прыгает».
test("UIX-FIT-10: чип даты — «Без даты» для неизвестной, «11 ноя» для известной", () => {
  assert.equal(diaryDateChip(null), "Без даты");
  assert.equal(diaryDateChip("2026-11-11"), "11 ноя");
  assert.equal(diaryDateChip("не дата"), "Без даты");
  assert.ok(diaryDateChip(null).length <= "Не начата".length, "подпись неизвестной даты не длиннее самого короткого статуса");
});
