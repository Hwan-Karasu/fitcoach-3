import assert from "node:assert/strict";
import test from "node:test";
import { assignLogExercise, copyLogSets, copySetsSource, duplicateLogExercise, editLogWorkout, logExercises, logStats, logWeeks, mergeLogNames, parseWorkoutLog, removeLogExercise, similarLogNames, workoutLogTables, workoutLogWorkbook } from "../apps/mobile/src/features/import/domain/TextWorkoutLog.ts";
import { startWorkbookReview } from "../apps/mobile/src/features/import/domain/WorkbookReviewSession.ts";
import { prepareWholeWorkbook, wholeWorkbookStatus } from "../apps/mobile/src/features/import/domain/WholeWorkbookImport.ts";
import { builderWorkbookImport } from "../apps/mobile/src/features/import/domain/BuilderWorkbookImport.ts";
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
  // Ревью: числа в названии упражнения — не дата; дата без года — только «ДД.ММ» с двузначным месяцем через точку.
  const numbers = parseWorkoutLog("ноги 20.10.2026\nГантели 7.5\n10 на 12\nПрисед 1/2\n60 на 8\nЖим 10.30\n40 на 10", "2026-10-28");
  assert.deepEqual(numbers.workouts.map((w) => [w.date, w.exercises.map((e) => e.name)]), [["2026-10-20", ["Гантели 7.5", "Присед 1/2", "Жим 10.30"]]]);
  const plain = parseWorkoutLog("присед\n60 на 8\nжим\n40 на 10", "2026-10-28");
  assert.deepEqual(plain.workouts.map((w) => [w.title, w.date, w.exercises.length]), [["Тренировка 1", null, 2]]);
});

test("TEXT-LOG-2 распределение: «+» создаёт тренировку, перенос, правка названия и даты, объединение названий", () => {
  let log = parseWorkoutLog("присед\n60 на 8\nжим\n40 на 10\nтяга\n50 на 10", "2026-10-28");
  assert.deepEqual(log.workouts[0]!.exercises.map((e) => e.id), ["1", "3", "5"]);
  log = assignLogExercise(log, "3", 1);
  log = assignLogExercise(log, "5", 1);
  assert.deepEqual(log.workouts.map((w) => [w.title, w.exercises.map((e) => e.name)]), [["Тренировка 1", ["присед"]], ["Тренировка 2", ["жим", "тяга"]]]);
  log = assignLogExercise(log, "1", 1);
  assert.deepEqual(log.workouts.map((w) => w.exercises.map((e) => e.name)), [[], ["жим", "тяга", "присед"]]);
  log = editLogWorkout(log, 1, { title: "Ноги", date: "2026-10-20" });
  log = mergeLogNames(log, [["присед", "тяга"]]);
  assert.deepEqual(log.workouts[1]!.exercises.map((e) => e.name), ["жим", "присед", "присед"]);
  const [table] = workoutLogTables(log, { name: "Заметки", reps: null });
  const value = parse(table!);
  // Пустая тренировка не создаёт неделю; дата правки попадает в занятие.
  assert.deepEqual(value.programs[0]!.mesocycles[0]!.weeks.map((w) => w.workouts.map((x) => x.title)), [["Ноги"]]);
  assert.deepEqual(value.sessions.map((s) => [s.actualDate, s.facts.length]), [["2026-10-20", 3]]);
});

test("TEXT-LOG-3 номер дальше последней тренировки создаёт пустые, они не попадают в импорт; одинаковые названия — разные id", () => {
  let log = parseWorkoutLog("присед\n60 на 8\nприсед\n70 на 6", "2026-10-28");
  assert.deepEqual(log.workouts[0]!.exercises.map((e) => e.id), ["1", "3"]);
  log = assignLogExercise(log, "3", 3);
  assert.deepEqual(logExercises(log).map((item) => [item.exercise.id, item.workout]), [["1", 0], ["3", 3]]);
  assert.deepEqual(log.workouts.map((w) => [w.title, w.exercises.length]), [["Тренировка 1", 1], ["Тренировка 2", 0], ["Тренировка 3", 0], ["Тренировка 4", 1]]);
  assert.deepEqual(logStats(log), { weeks: 1, workouts: 2, exercises: 2, sets: 2 });
  const [table] = workoutLogTables(log, { name: "Заметки", reps: null });
  assert.deepEqual(parse(table!).programs[0]!.mesocycles[0]!.weeks[0]!.workouts.map((w) => w.title), ["Тренировка 1", "Тренировка 4"]);
  assert.equal(assignLogExercise(log, "нет", 1), log);
});

test("TEXT-LOG-5 неделя — следствие даты: из дат хронологически, без дат — все тренировки в одной неделе", () => {
  // 8 записей (даты синтетические): календарные недели с понедельника — 7 недель, в четвёртой две тренировки.
  const days = ["26.07.2026", "31.07.2026", "03.08.2026", "04.09.2026", "06.09.2026", "14.09.2026", "21.09.2026", "28.09.2026"];
  let log = parseWorkoutLog(days.map((day) => `фуллбоди ${day}\nприсед\n60 на 8`).join("\n"), "2026-10-28");
  assert.deepEqual([...logWeeks(log)], [[0, 0], [1, 1], [2, 2], [3, 3], [4, 3], [5, 4], [6, 5], [7, 6]]);
  assert.deepEqual(logStats(log), { weeks: 7, workouts: 8, exercises: 8, sets: 8 });
  // Записи вразнобой — пикер и недели всё равно по хронологии.
  const shuffled = parseWorkoutLog("фуллбоди 28.09.2026\nприсед\n60 на 8\nфуллбоди 26.07.2026\nприсед\n60 на 8", "2026-10-28");
  assert.deepEqual(shuffled.workouts.map((w) => w.date), ["2026-07-26", "2026-09-28"]);
  // Правка даты двигает неделю сама: 04.09 → 27.07 переносит тренировку в неделю второй записи.
  log = editLogWorkout(log, 3, { date: "2026-07-27" });
  assert.deepEqual([...logWeeks(log)], [[0, 0], [3, 1], [1, 1], [2, 2], [4, 3], [5, 4], [6, 5], [7, 6]]);
  assert.equal(logStats(log).weeks, 7);
  // Без дат — сколько распределили тренировок, столько и в неделе; пустые тренировки не считаются.
  let plain = parseWorkoutLog("присед\n60 на 8\nжим\n40 на 10\nтяга\n50 на 10", "2026-10-28");
  plain = assignLogExercise(assignLogExercise(plain, "3", 1), "5", 2);
  assert.deepEqual([...logWeeks(plain)], [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(logStats(plain), { weeks: 1, workouts: 3, exercises: 3, sets: 3 });
  assert.deepEqual(logStats(assignLogExercise(plain, "5", 6)), { weeks: 1, workouts: 3, exercises: 3, sets: 3 });
  // Новая тренировка без даты среди датированных остаётся в неделе предыдущей, а не ломает календарные недели.
  const mixed = duplicateLogExercise(parseWorkoutLog("день 26.07.2026\nприсед\n60 на 8\nдень 03.08.2026\nжим\n40 на 10", "2026-10-28"), "5")!.log;
  assert.deepEqual([...logWeeks(mixed)], [[0, 0], [1, 1], [2, 1]]);
  // Таблица: все три тренировки одной недели.
  assert.deepEqual(parse(workoutLogTables(plain, { name: "Заметки", reps: null })[0]!).programs[0]!.mesocycles[0]!.weeks.map((w) => [w.index, w.workouts.length]), [[1, 3]]);
});

test("TEXT-LOG-3 дубликат — плановая строка без фактов в следующей тренировке; копирование подходов переносит факты", () => {
  let log = parseWorkoutLog("жим\n60 на 8\n60 на 8\n50 на 10", "2026-10-28");
  const duplicated = duplicateLogExercise(log, "1")!;
  log = duplicated.log;
  assert.equal(duplicated.id, "1+1");
  assert.deepEqual(log.workouts.map((w) => w.exercises.map((e) => [e.id, e.sets.length, e.planSets ?? null])), [[["1", 3, null]], [["1+1", 0, 3]]]);
  assert.equal(duplicateLogExercise(log, "1")!.id, "1+2");
  // Порядок списка — по тексту, копия сразу после исходного, и он не зависит от тренировки.
  assert.deepEqual(logExercises(assignLogExercise(log, "1+1", 4)).map((item) => [item.exercise.id, item.workout]), [["1", 0], ["1+1", 4]]);
  assert.equal(copySetsSource(log, "1+1")!.id, "1");
  assert.equal(copySetsSource(log, "1"), null);
  assert.deepEqual(logStats(log), { weeks: 1, workouts: 2, exercises: 2, sets: 6 });
  // Копия без фактов даёт одну плановую строку «3 подхода»: подходы создаются, фактов нет.
  const value = parse(workoutLogTables(log, { name: "Заметки", reps: { min: 8, max: 12 } })[0]!);
  assertValidTransfer(value);
  const planned = value.programs[0]!.mesocycles[0]!.weeks[0]!.workouts[1]!.exercises[0]!;
  assert.deepEqual(planned.sets.map((s) => [s.reps, s.repsMax]), [[8, 12], [8, 12], [8, 12]]);
  assert.deepEqual(value.sessions.map((s) => s.facts.length), [3]);
  // «Копировать подходы»: только из упражнения с тем же названием и подходами; планового счётчика после этого нет.
  assert.equal(copyLogSets(log, "1+1", "1+1"), log);
  const copied = copyLogSets(log, "1+1", "1");
  assert.deepEqual(copied.workouts[1]!.exercises[0]!.sets.map((s) => [s.loadKg, s.reps]), [[60, 8], [60, 8], [50, 10]]);
  assert.equal(copied.workouts[1]!.exercises[0]!.planSets, undefined);
  assert.deepEqual(logStats(copied), { weeks: 1, workouts: 2, exercises: 2, sets: 6 });
  // Источник — только с тем же названием; существующие факты не затираются.
  const other = parseWorkoutLog("жим\n60 на 8\nтяга\n50 на 10\nприсед", "2026-10-28");
  assert.equal(copySetsSource(other, "7"), null);
  assert.equal(copyLogSets(other, "1", "3"), other);
  // Названия после «объединить» расходятся с сырым журналом: копирование идёт по id и не зависит от имён.
  const renamed = parseWorkoutLog("присед\n60 на 8\nприсед\n", "2026-10-28");
  assert.deepEqual(copyLogSets(renamed, "3", "1").workouts[0]!.exercises[1]!.sets.map((s) => s.reps), [8]);
  // Убрать можно любое упражнение черновика.
  assert.equal(removeLogExercise(log, "нет"), log);
  assert.deepEqual(removeLogExercise(log, "1").workouts.map((w) => w.exercises.map((e) => e.id)), [[], ["1+1"]]);
  assert.deepEqual(removeLogExercise(log, "1+1").workouts.map((w) => w.exercises.length), [1, 0]);
  assert.deepEqual(logStats(removeLogExercise(log, "1+1")), { weeks: 1, workouts: 1, exercises: 1, sets: 3 });
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

test("TEXT-LOG-2 заметки проходят обычную сверку: тип цикла и повторения попадают в цикл конструктора, факты — в черновик", () => {
  const text = "ноги 20.10.2026\nприсед\n60 на 8\n70 на 6";
  const picked = workoutLogWorkbook(parseWorkoutLog(text, "2026-10-28"), { name: "Заметки", cycleType: "strength", reps: { min: 6, max: 8 } });
  assert.match(picked.kind === "TABLES" ? picked.sourceId : "", /^text:[0-9a-f]{64}$/u);
  let session = prepareWholeWorkbook(startWorkbookReview(picked, false), [{ id: "squat", name: "присед", available: true }]);
  assert.equal(wholeWorkbookStatus(session).problems.length, 0);
  session = { ...session, programTitle: "Заметки" };
  const cycle = builderWorkbookImport(session).cycles![0]!;
  assert.deepEqual(cycle.settings, { cycleType: "strength", repRange: { min: 6, max: 8 }, startDate: undefined });
  assert.deepEqual(cycle.weeks[0]!.workouts[0]!.exercises[0]!.sets.map((s) => [s.reps, s.repsMax]), [[6, 8], [6, 8]]);
  assert.deepEqual(cycle.imported!.sessions[0]!.facts.map((f) => [f.exerciseId, f.values.reps, f.values.loadGrams]), [["squat", 8, 60000], ["squat", 6, 70000]]);
  assert.throws(() => workoutLogWorkbook(parseWorkoutLog("присед", "2026-10-28"), { name: "Заметки", reps: null }), /нет подходов/);
  // Тот же текст с другим типом цикла — другой источник: повторный импорт в черновик добавит цикл, а не даст «Конфликт цикла».
  const other = workoutLogWorkbook(parseWorkoutLog(text, "2026-10-28"), { name: "Заметки", cycleType: "hypertrophy", reps: { min: 8, max: 12 } });
  assert.notEqual(other.kind === "TABLES" && picked.kind === "TABLES" ? other.sourceId : "", picked.kind === "TABLES" ? picked.sourceId : "");
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
