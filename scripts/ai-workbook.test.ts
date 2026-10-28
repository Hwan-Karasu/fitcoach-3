import assert from "node:assert/strict";
import test from "node:test";
import { AI_WORKBOOK_PROMPT, aiWorkbookRows } from "../apps/mobile/src/features/import/domain/AiWorkbookTemplate.ts";
import { detectLegacyMapping, legacyFields, normalizeLegacyTable } from "../apps/mobile/src/features/import/domain/LegacyExcel.ts";
import { assertValidTransfer } from "../apps/mobile/src/features/import/domain/TransferValidation.ts";

test("EXCEL-AI образец для ИИ читается импортом без настройки: строка — подход, план и факт, одна дата на тренировку", () => {
  const table = { name: "Тренировки", rows: aiWorkbookRows() };
  const found = detectLegacyMapping(table);
  assert.equal(found.header, 0);
  assert.deepEqual(Object.keys(found.mapping).sort(), ["actualLoad", "actualReps", "date", "exercise", "load", "note", "reps", "rir", "sets", "week", "workout"]);
  const value = normalizeLegacyTable(table, "ai-template", found.header, found.mapping);
  assertValidTransfer(value);
  const weeks = value.programs[0]!.mesocycles[0]!.weeks;
  assert.deepEqual(weeks.map((w) => w.workouts.map((x) => [x.title, x.exercises.map((e) => e.sets.length)])),
    [[["Тренировка А", [2, 1]], ["Тренировка Б", [1]]], [["Тренировка А", [1]]]]);
  assert.deepEqual(weeks[0]!.workouts[0]!.exercises[0]!.sets.map((s) => [s.reps, s.repsMax, s.loadGrams]), [[8, 10, 60000], [8, 10, 60000]]);
  assert.deepEqual(value.sessions.map((s) => [s.weekIndex, s.actualDate, s.facts.map((f) => [f.values.reps, f.values.loadGrams])]), [
    [1, "2026-10-05", [[10, 60000], [9, 60000], [12, 45000]]], [1, "2026-10-07", [[8, 80000]]]]);
});

test("EXCEL-AI промпт называет ровно столбцы образца и запрещает выдумывать значения", () => {
  for (const title of Object.values(legacyFields).filter((t) => !/секунд|метров/u.test(t))) assert.ok(AI_WORKBOOK_PROMPT.includes(title), title);
  assert.match(AI_WORKBOOK_PROMPT, /ДД\.ММ\.ГГГГ/u);
  assert.match(AI_WORKBOOK_PROMPT, /не выдумывай/iu);
});

test("EXCEL-AI заголовки распознаются по синонимам: сокращения, точки, регистр, «ё»", () => {
  const table = { name: "Лист1", rows: [["Мой дневник"],
    ["Нед.", "Занятие", "Название упражнения", "Кол-во подходов", "План повт.", "План, кг", "Факт повт.", "Факт, кг", "Дата", "Комментарий"],
    ["1", "Ноги", "Присед", "1", "6-8", "80", "8", "80", "05.10.2026", "легко"]] };
  const found = detectLegacyMapping(table);
  assert.equal(found.header, 1);
  assert.deepEqual(found.mapping, { week: 0, workout: 1, exercise: 2, sets: 3, reps: 4, load: 5, actualReps: 6, actualLoad: 7, date: 8, note: 9 });
  // Неоднозначные «Подход» (номер подхода) и «День» не принимаются за количество подходов и тренировку.
  assert.deepEqual(detectLegacyMapping({ name: "Лист1", rows: [["День", "Упражнение", "Подход"]] }).mapping, { exercise: 1 });
});
