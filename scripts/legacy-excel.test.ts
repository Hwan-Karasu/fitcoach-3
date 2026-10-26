import assert from "node:assert/strict";
import { test } from "node:test";
import { detectLegacyMapping, normalizeLegacyTable } from "../apps/mobile/src/features/import/domain/LegacyExcel.ts";
import { flattenLegacyMatrix } from "../apps/mobile/src/features/import/domain/LegacyMatrix.ts";
import { spreadsheetDay } from "../apps/mobile/src/shared/training-transfer/SpreadsheetDay.ts";
test("legacy flat template retains planned ranges, decimal weight and per-set actual values", () => {
  const table = { name: "План", rows: [["Неделя", "Тренировка", "Упражнение", "Подходы", "План повторений", "План вес", "Факт повторений", "Факт вес", "Дата"], [1, "А", "Жим", 1, "8-10", "62,5", 9, "62,5", "26.10.2026"], [1, "А", "Жим", 1, "8-10", "62,5", 8, "60", "2026-10-26"]] };
  const detected = detectLegacyMapping(table); const value = normalizeLegacyTable(table, "source", detected.header, detected.mapping);
  const exercise = value.programs[0]?.mesocycles[0]?.weeks[0]?.workouts[0]?.exercises[0];
  assert.equal(exercise?.sets.length, 2); assert.equal(exercise?.sets[0]?.loadGrams, 62500);
  assert.equal(value.sessions[0]?.facts[1]?.plannedExerciseId, exercise?.id); assert.equal(value.sessions[0]?.facts[1]?.position, 1);
  assert.equal(value.sessions[0]?.actualDate, "2026-10-26");
});
test("matrix template matches app layout and ignores previous as input", () => {
  const matrix = { name: "Матрица", rows: [["Упражнение", "Подход", "Неделя 1", "", "", "", "", "Неделя 2"], ["", "", "План", "Пред.", "Повт.", "Кг", "Дата", "План", "Пред.", "Повт.", "Кг", "Дата"], ["Тренировка 1"], ["Жим", 1, "8–10 × 62,5 кг", "999 × 999 кг", 9, "62,5", "2026-10-20", "8–10 × 65 кг", "9 × 62,5 кг", "", "", ""]] };
  const table = flattenLegacyMatrix(matrix)!; assert.ok(table);
  const detected = detectLegacyMapping(table); const value = normalizeLegacyTable(table, "source", detected.header, detected.mapping);
  assert.equal(value.programs[0]?.mesocycles[0]?.weeks.length, 2); assert.equal(value.sessions.length, 1); assert.equal(value.sessions[0]?.facts.length, 1);
});
test("old four-column weekly matrix keeps planned and actual columns separate", () => {
  const matrix = { name: "Старый лист", rows: [["", "", "Неделя 1"], ["Упражнение / подход", "", "Пл. повт", "Пл. вес", "Ф. повт", "Ф. вес"], ["Присед", 1, "8-12", "80", 10, "82,5"]] };
  const table = flattenLegacyMatrix(matrix)!; const detected = detectLegacyMapping(table);
  const value = normalizeLegacyTable(table, "source", detected.header, detected.mapping);
  assert.equal(value.sessions[0]?.actualDate, null); assert.equal(value.sessions[0]?.facts[0]?.values.loadGrams, 82500);
  assert.equal(value.programs[0]?.mesocycles[0]?.weeks[0]?.workouts[0]?.exercises[0]?.sets[0]?.loadGrams, 80000);
});
test("Excel dates preserve calendar days, including the 1904 system, and reject invalid dates", () => {
  assert.equal(spreadsheetDay(25569), "1970-01-01"); assert.equal(spreadsheetDay(24107, true), "1970-01-01");
  assert.equal(spreadsheetDay("31.02.2026"), null); assert.equal(spreadsheetDay(60), null);
});
