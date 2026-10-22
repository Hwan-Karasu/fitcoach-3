import assert from "node:assert/strict";
import test from "node:test";
import { weekStart, workoutsInWeek } from "../src/read-models/trainingWeek.ts";

const entry = (actualDate: string, workingSets = 3) => ({ actualDate, workingSets });

test("A02 неделя считается Пн–Вс: воскресенье относится к прошедшей неделе, понедельник начинает новую", () => {
  // 2026-10-22 — четверг; понедельник той недели — 2026-10-19.
  assert.equal(weekStart("2026-10-22"), "2026-10-19");
  assert.equal(weekStart("2026-10-19"), "2026-10-19");
  assert.equal(weekStart("2026-10-25"), "2026-10-19", "воскресенье");
  assert.equal(weekStart("2026-10-26"), "2026-10-26", "следующий понедельник");
  assert.equal(weekStart("2026-01-01"), "2025-12-29", "переход через год");
});

test("A02 «Трен./нед.»: границы недели включительно, пустые тренировки не считаются", () => {
  const entries = [entry("2026-10-18"), entry("2026-10-19"), entry("2026-10-22"), entry("2026-10-25"), entry("2026-10-26"), entry("2026-10-21", 0)];
  assert.equal(workoutsInWeek(entries, "2026-10-22"), 3, "Пн 19, Чт 22 и Вс 25; воскресенье 18 и понедельник 26 — соседние недели");
  assert.equal(workoutsInWeek(entries, "2026-10-27"), 1);
});

test("A02 «Трен./нед.»: нет ни одной тренировки — «нет данных», были раньше, но не на этой неделе — 0", () => {
  assert.equal(workoutsInWeek([], "2026-10-22"), null);
  assert.equal(workoutsInWeek([entry("2026-10-21", 0)], "2026-10-22"), null);
  assert.equal(workoutsInWeek([entry("2026-09-01")], "2026-10-22"), 0);
});
