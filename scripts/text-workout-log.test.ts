import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkoutLog, similarLogNames, workoutLogTables } from "../apps/mobile/src/features/import/domain/TextWorkoutLog.ts";
import { detectLegacyMapping, normalizeLegacyTable } from "../apps/mobile/src/features/import/domain/LegacyExcel.ts";
import { assertValidTransfer } from "../apps/mobile/src/features/import/domain/TransferValidation.ts";
import type { ImportTable } from "../apps/mobile/src/features/import/domain/WorkbookFilesPort.ts";

const parse = (table: ImportTable) => { const found = detectLegacyMapping(table); return normalizeLegacyTable(table, "text:synthetic", found.header, found.mapping); };

// Синтетический фрагмент в стиле заметок владельца (TEXT-LOG-1): регистр, лишние пробелы, год из двух цифр,
// упражнение без пустой строки после подходов, комментарий в скобках, две тренировки в одной неделе.
const NOTES = [
  "фуллбоди 26.07.2026", "экстензия", "0 на 15", "0 на 13 ", "",
  "разгибания на квадру ", "22 на 15", "27,5 на 14", "жим на переднюю дельту", "20 на 15 (огонь)", "",
  "фуллбоди 04.09.2026", "экстензия ", "0 на 20 (полная амплитуда)", "",
  "фуллбоди 06.09.26", "Экстензия", "5 кг на 20 раз", "22 на", "разгибание на квадру", "31 на 20 x 2",
].join("\n");

test("TEXT-LOG-1 заголовок с датой — тренировка, строка «вес на повторы» — подход, остальное — упражнение", () => {
  const log = parseWorkoutLog(NOTES, "2026-10-28");
  assert.deepEqual(log.workouts.map((w) => [w.title, w.date, w.line]), [
    ["Фуллбоди", "2026-07-26", 1], ["Фуллбоди", "2026-09-04", 12], ["Фуллбоди", "2026-09-06", 16]]);
  assert.deepEqual(log.workouts[0]!.exercises.map((e) => [e.name, e.sets.map((s) => [s.loadKg, s.reps, s.note])]), [
    ["экстензия", [[0, 15, null], [0, 13, null]]],
    ["разгибания на квадру", [[22, 15, null], [27.5, 14, null]]],
    ["жим на переднюю дельту", [[20, 15, "огонь"]]]]);
  assert.deepEqual(log.workouts[1]!.exercises[0]!.sets.map((s) => [s.loadKg, s.reps, s.note, s.line]), [[0, 20, "полная амплитуда", 14]]);
  assert.deepEqual(log.workouts[2]!.exercises.map((e) => [e.name, e.sets.map((s) => [s.loadKg, s.reps])]), [
    ["Экстензия", [[5, 20]]], ["разгибание на квадру", [[31, 20], [31, 20]]]]);
  assert.deepEqual(log.unknownLines, [{ line: 19, text: "22 на" }]);
});

test("TEXT-LOG-1 дата без года — ближайшая прошедшая; без заголовка всё идёт в одну тренировку без даты", () => {
  assert.equal(parseWorkoutLog("ноги 30.12\nприсед\n60 на 8", "2026-10-28").workouts[0]!.date, "2025-12-30");
  assert.equal(parseWorkoutLog("ноги 01.10\nприсед\n60 на 8", "2026-10-28").workouts[0]!.date, "2026-10-01");
  const plain = parseWorkoutLog("присед\n60 на 8\nжим\n40 на 10", "2026-10-28");
  assert.deepEqual(plain.workouts.map((w) => [w.title, w.date, w.exercises.length]), [["Тренировка", null, 2]]);
});

test("TEXT-LOG-1 похожие названия только предлагаются: опечатка, окончание, порядок слов; разные упражнения — нет", () => {
  const log = parseWorkoutLog(["день", "жим в тренежере", "1 на 1", "жим в тренажере", "1 на 1", "тяга вертикальная", "1 на 1",
    "вертикальная тяга", "1 на 1", "жим на дельту в тренажере", "1 на 1", "махи", "1 на 1", "мах", "1 на 1"].join("\n"), "2026-10-28");
  assert.deepEqual(similarLogNames(log), [["жим в тренежере", "жим в тренажере"], ["тяга вертикальная", "вертикальная тяга"]]);
});

test("TEXT-LOG-1 таблица: календарные недели без пустых, повтор названия в неделе, план по типу цикла, факты и даты", () => {
  const log = parseWorkoutLog(NOTES, "2026-10-28");
  const [table, ...rest] = workoutLogTables(log, { name: "Заметки", reps: { min: 8, max: 12 } });
  assert.equal(rest.length, 0);
  const value = parse(table!);
  assertValidTransfer(value);
  const weeks = value.programs[0]!.mesocycles[0]!.weeks;
  assert.deepEqual(weeks.map((w) => [w.index, w.workouts.map((x) => x.title)]), [[1, ["Фуллбоди"]], [2, ["Фуллбоди", "Фуллбоди 2"]]]);
  assert.deepEqual(value.sessions.map((s) => [s.weekIndex, s.actualDate, s.facts.length]), [[1, "2026-07-26", 5], [2, "2026-09-04", 1], [2, "2026-09-06", 3]]);
  // «Экстензия» и «экстензия» — одно упражнение; название берётся из первого вхождения.
  assert.deepEqual(value.exercises.map((e) => e.name), ["экстензия", "разгибания на квадру", "жим на переднюю дельту", "разгибание на квадру"]);
  const first = weeks[0]!.workouts[0]!.exercises[0]!;
  assert.deepEqual(first.sets.map((s) => [s.reps, s.repsMax, s.loadGrams]), [[8, 12, null], [8, 12, null]]);
  assert.deepEqual(value.sessions[0]!.facts.slice(2, 4).map((f) => [f.values.reps, f.values.loadGrams]), [[15, 22000], [14, 27500]]);
  assert.equal(weeks[0]!.workouts[0]!.exercises[2]!.instruction, "Подход 1: огонь");
});

test("TEXT-LOG-1 тип «Свой» оставляет план пустым; больше 52 недель с занятиями — несколько листов", () => {
  // 53 понедельника подряд начиная с 05.01.2026.
  const days = Array.from({ length: 53 }, (_, i) => new Date(Date.UTC(2026, 0, 5 + 7 * i)).toISOString().slice(0, 10));
  const text = days.map((day) => `день ${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}\nприсед\n60 на 8`).join("\n");
  const tables = workoutLogTables(parseWorkoutLog(text, "2027-02-01"), { name: "Заметки", reps: null });
  assert.deepEqual(tables.map((t) => t.name), ["Заметки", "Заметки 2"]);
  const parsed = tables.map(parse);
  assert.deepEqual(parsed.map((v) => v.programs[0]!.mesocycles[0]!.weeks.length), [52, 1]);
  assert.deepEqual(parsed.map((v) => v.sessions[0]!.actualDate), ["2026-01-05", "2027-01-04"]);
  assert.equal(parsed[0]!.programs[0]!.mesocycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.sets[0]!.reps, null);
});
