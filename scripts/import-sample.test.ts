import assert from "node:assert/strict";
import test from "node:test";
import { IMPORT_SAMPLE_LABELS, importSampleSheet } from "../apps/mobile/src/features/import/domain/ImportSample.ts";
import { detectLegacyMapping, normalizeLegacyTable } from "../apps/mobile/src/features/import/domain/LegacyExcel.ts";
import { flattenLegacyMatrix } from "../apps/mobile/src/features/import/domain/LegacyMatrix.ts";
import { assertValidTransfer } from "../apps/mobile/src/features/import/domain/TransferValidation.ts";

// Образец для импорта читается так же, как файл из 2.0: лист читается построчно в строки текста (как \`sheet_to_json\` при выборе файла), затем матрица разворачивается в плоскую таблицу.
const asPicked = () => ({ name: "Гипертрофия", rows: importSampleSheet().rows.map((row) => row.map((cell) => String(cell))) });

test("образец для импорта — матрица как в 2.0: название, «Упражнение | Подход | Неделя N» (по пять столбцов), подписи «План | Пред. | Повт. | Кг | Дата», тренировки строками", () => {
  const { rows, merges } = importSampleSheet();
  assert.deepEqual(rows[1]!.slice(0, 3), ["Упражнение", "Подход", "Неделя 1"]);
  assert.equal(rows[1]![7], "Неделя 2"); assert.equal(rows[1]![12], "Неделя 3");
  assert.deepEqual(rows[2]!.slice(2, 7), [...IMPORT_SAMPLE_LABELS]);
  assert.equal(rows[3]![0], "Тренировка А");
  assert.ok(merges.some((m) => m.r === 1 && m.c0 === 2 && m.c1 === 6), "неделя 1 объединена по пяти столбцам");
  assert.ok(merges.some((m) => m.r === 3 && m.c0 === 0 && m.c1 === 16), "строка тренировки объединена по ширине");
});

test("образец для импорта читается импортом без настройки: 3 недели, 2 тренировки, факты и даты как в образце", () => {
  const flat = flattenLegacyMatrix(asPicked());
  assert.ok(flat, "матрица распознана");
  const found = detectLegacyMapping(flat);
  const value = normalizeLegacyTable(flat, "import-sample", found.header, found.mapping);
  assertValidTransfer(value);
  const weeks = value.programs[0]!.mesocycles[0]!.weeks;
  assert.equal(weeks.length, 3);
  assert.deepEqual(weeks[0]!.workouts.map((x) => [x.title, x.exercises.map((e) => e.sets.length)]), [["Тренировка А", [3, 2]], ["Тренировка Б", [3]]]);
  assert.deepEqual(weeks[0]!.workouts[0]!.exercises[0]!.sets.map((s) => [s.reps, s.repsMax, s.loadGrams]), [[8, 10, 60000], [8, 10, 60000], [8, 10, 60000]]);
  assert.deepEqual(weeks[2]!.workouts[0]!.exercises[0]!.sets.map((s) => s.loadGrams), [65000, 65000, 65000], "план третьей недели без фактов");
  const sessions = [...value.sessions].sort((a, b) => a.weekIndex - b.weekIndex || String(a.actualDate).localeCompare(String(b.actualDate)));
  assert.deepEqual(sessions.map((s) => [s.weekIndex, s.actualDate, s.facts.length]), [[1, "2026-10-05", 5], [1, "2026-10-07", 3], [2, "2026-10-12", 5], [2, "2026-10-14", 3]],
    "у третьей недели фактов нет — сеансов нет");
  assert.deepEqual(sessions[0]!.facts.slice(0, 3).map((f) => [f.values.reps, f.values.loadGrams]), [[10, 60000], [9, 60000], [8, 60000]]);
  assert.deepEqual(sessions[2]!.facts.slice(0, 1).map((f) => [f.values.reps, f.values.loadGrams]), [[10, 62500]]);
});

test("заголовки плоской таблицы распознаются по синонимам: сокращения, точки, регистр, «ё»", () => {
  const table = { name: "Лист1", rows: [["Мой дневник"],
    ["Нед.", "Занятие", "Название упражнения", "Кол-во подходов", "План повт.", "План, кг", "Факт повт.", "Факт, кг", "Дата", "Комментарий"],
    ["1", "Ноги", "Присед", "1", "6-8", "80", "8", "80", "05.10.2026", "легко"]] };
  const found = detectLegacyMapping(table);
  assert.equal(found.header, 1);
  assert.deepEqual(found.mapping, { week: 0, workout: 1, exercise: 2, sets: 3, reps: 4, load: 5, actualReps: 6, actualLoad: 7, date: 8, note: 9 });
  // Неоднозначные «Подход» (номер подхода) и «День» не принимаются за количество подходов и тренировку.
  assert.deepEqual(detectLegacyMapping({ name: "Лист1", rows: [["День", "Упражнение", "Подход"]] }).mapping, { exercise: 1 });
});
