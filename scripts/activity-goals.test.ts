import assert from "node:assert/strict";
import test from "node:test";
import { goalFraction, MEALS_GOAL, STEPS_GOAL } from "../apps/mobile/src/features/nutrition/domain/ActivityGoals.ts";
import { mealCount, summarizeDay } from "../apps/mobile/src/features/nutrition/domain/DiaryRules.ts";
import type { EatenEntry } from "../apps/mobile/src/features/nutrition/domain/DiaryModel.ts";

test("UIX-05: стартовые цели по умолчанию — шаги 10 000, приёмы пищи 4 (решение владельца)", () => {
  assert.equal(STEPS_GOAL, 10000);
  assert.equal(MEALS_GOAL, 4);
});

test("UIX-05: доля цели — нет данных остаётся «нет данных», а не нулём; перевыполнение больше единицы", () => {
  assert.equal(goalFraction(null, 10000), null);
  assert.equal(goalFraction(0, 10000), 0);
  assert.equal(goalFraction(2500, 10000), 0.25);
  assert.equal(goalFraction(12000, 10000), 1.2);
  assert.equal(goalFraction(5, 0), null, "цель ноль — деления нет");
});

const entry = (id: string, slot: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK", kcalX10: number): EatenEntry => ({ id, clientId: "c", localDate: "2026-11-10", slot,
  snapshot: { eaten: { kcalX10, proteinX10: 0, fatX10: 0, carbsX10: 0 } } } as unknown as EatenEntry);

test("UIX-05: число приёмов пищи — приёмы с записями, а не число записей; пустой день — 0", () => {
  assert.equal(mealCount(summarizeDay("2026-11-10", [])), 0);
  const day = summarizeDay("2026-11-10", [entry("1", "BREAKFAST", 100), entry("2", "BREAKFAST", 200), entry("3", "LUNCH", 300)]);
  assert.equal(day.foodEntries, 3);
  assert.equal(mealCount(day), 2, "завтрак с двумя продуктами и обед — два приёма");
});
