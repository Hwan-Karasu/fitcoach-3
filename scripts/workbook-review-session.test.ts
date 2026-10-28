import assert from "node:assert/strict";
import test from "node:test";
import { flattenLegacyMatrix } from "../apps/mobile/src/features/import/domain/LegacyMatrix.ts";
import { detectLegacyMapping, normalizeLegacyTable } from "../apps/mobile/src/features/import/domain/LegacyExcel.ts";
import { correctTransferIssue } from "../apps/mobile/src/features/import/domain/IssueCorrections.ts";
import { startWorkbookReview, selectWorkbookSheet, updateWorkbookEntry, applyWorkbookColumns, correctWorkbookValue } from "../apps/mobile/src/features/import/domain/WorkbookReviewSession.ts";
import { readWorkbook, readTrainingWorkbook, writeTrainingWorkbook } from "../apps/mobile/src/features/import/data/TrainingWorkbook.ts";
import type { ImportTable, PickedWorkbook } from "../apps/mobile/src/features/import/domain/WorkbookFilesPort.ts";
import { trainingTransferFixture } from "./training-transfer-fixture.ts";
import { compileWholeWorkbook, prepareWholeWorkbook, wholeWorkbookStatus, workbookUnmatchedTargets } from "../apps/mobile/src/features/import/domain/WholeWorkbookImport.ts";
import { setWorkbookNameMatch, workbookMatchesToRemember, selectWorkbookImportSheets } from "../apps/mobile/src/features/import/domain/WorkbookReviewSession.ts";
import { prepareWorkbookResponsive } from "../apps/mobile/src/features/import/domain/WholeWorkbookImport.ts";

function matrix(name = "Первый лист", actual: unknown = "8-10", weight: unknown = "42,5"): ImportTable {
  return flattenLegacyMatrix({ name, rows: [
    ["Программа"], ["Упражнение", "Подход", "Неделя 1"], ["", "", "План", "Пред.", "Повт.", "Кг", "Дата"],
    ["Тренировка A"], ["Жим штанги лёжа", 1, "8–10 × 62,5 кг", "", actual, weight, "2026-10-20"],
    ["", 2, "8–10 × 62,5 кг", "", "12", "20", "2026-10-20"],
  ] })!;
}
const parse = (table: ImportTable) => { const found = detectLegacyMapping(table); return normalizeLegacyTable(table, "synthetic-file", found.header, found.mapping); };
const picked = (tables: readonly ImportTable[]): PickedWorkbook => ({ kind: "TABLES", sourceId: "synthetic-file", tables });

test("I05 all sheets become ordered independent cycles in one programme regardless of active tab", () => {
  let session = prepareWholeWorkbook(startWorkbookReview({ ...picked([matrix("Первый", "8"), matrix("Второй", "9"), matrix("Третий", "10")]), filename: "Сила.xlsx" }, false),
    [{ id: "target", name: "Жим штанги лёжа", available: true }]);
  session = setWorkbookNameMatch(session, "Жим штанги лёжа", "target");
  const whole = compileWholeWorkbook(session);
  assert.equal(whole.value.programs.length, 1);
  assert.equal(whole.value.programs[0]!.title, "Сила");
  assert.deepEqual(whole.value.programs[0]!.mesocycles.map((c) => c.title), ["Первый", "Второй", "Третий"]);
  assert.equal(whole.value.sessions.length, 3);
  assert.deepEqual(whole.value.sessions.map((s) => s.facts[0]!.values.reps), [8, 9, 10]);
  assert.equal(new Set(whole.value.sessions.map((s) => s.plannedWorkoutId)).size, 3);
  assert.deepEqual(compileWholeWorkbook(selectWorkbookSheet(session, "2")), whole);
  assert.deepEqual(workbookMatchesToRemember(session, true), [{ sourceName: "Жим штанги лёжа", targetId: "target" }]);
});

test("I05 inactive invalid values and settings block the entire book until explicitly corrected", () => {
  let session = prepareWholeWorkbook(startWorkbookReview(picked([matrix("Первый", "8"), matrix("Второй")]), false),
    [{ id: "target", name: "Жим штанги лёжа", available: true }]);
  assert.equal(session.activeId, "0");
  assert.equal(wholeWorkbookStatus(session).problems[0]!.id, "1");
  assert.throws(() => compileWholeWorkbook(session), /Второй/);
  session = selectWorkbookSheet(session, "1");
  session = correctWorkbookValue(session, session.entries["1"]!.value!.issues![0]!.id, "пусто");
  session = updateWorkbookEntry(session, { settingsDirty: true });
  assert.throws(() => compileWholeWorkbook(session), /настройки/);
  session = applyWorkbookColumns(session);
  assert.equal(wholeWorkbookStatus(session).problems.length, 0);
  assert.equal(compileWholeWorkbook(session).value.sessions[1]!.facts[0]!.values.reps, null);
});

test("I05 empty sheets are explicitly reported, while malformed nonempty sheets cannot be silently skipped", () => {
  const empty = flattenLegacyMatrix({ name: "Пустой", rows: [["Упражнение", "Подход", "Неделя 1"], ["", "", "План", "Пред.", "Повт.", "Кг", "Дата"]] })!;
  const session = prepareWholeWorkbook(startWorkbookReview(picked([empty, matrix("Цикл", "8"), { name: "Пустой лист", rows: [[]] }]), false),
    [{ id: "target", name: "Жим штанги лёжа", available: true }]);
  assert.deepEqual(wholeWorkbookStatus(session).emptySheets, ["Пустой", "Пустой лист"]);
  assert.equal(compileWholeWorkbook(session).value.programs[0]!.mesocycles.length, 1);
  const bad = prepareWholeWorkbook(startWorkbookReview(picked([matrix("Цикл", "8"), { name: "Неверный", rows: [["что-то"], ["данные"]] }]), false),
    [{ id: "target", name: "Жим штанги лёжа", available: true }]);
  assert.throws(() => compileWholeWorkbook(bad), /Неверный/);
});

test("I05 canonical simple weeks reuse source rows but receive distinct cycle/week IDs with linked facts and notes", () => {
  const base = trainingTransferFixture(); const original = base.programs[0]!; const workout = original.mesocycles[0]!.weeks[0]!.workouts[0]!;
  const value = { ...base, programs: [{ ...original, kind: "SIMPLE" as const, simple: { weeks: 3, workouts: [workout] }, simpleWeeks: [], mesocycles: [] }],
    sessions: base.sessions.map((s) => ({ ...s, plannedWorkoutId: workout.id, notes: [{ plannedExerciseId: workout.exercises[0]!.id, text: "Note" }],
      facts: s.facts.map((f) => ({ ...f, plannedSetId: workout.exercises[0]!.sets[0]!.id, plannedExerciseId: workout.exercises[0]!.id })) })) };
  const session = prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value }, false), [{ id: "target", name: base.exercises[0]!.name, available: true }]);
  const output = compileWholeWorkbook(session).value;
  const weeks = output.programs[0]!.mesocycles[0]!.weeks;
  assert.equal(new Set(weeks.flatMap((w) => w.workouts.map((item) => item.id))).size, 3);
  for (const s of output.sessions) {
    const w = weeks.find((w) => w.index === s.weekIndex)!.workouts[0]!;
    assert.equal(s.plannedWorkoutId, w.id);
    if (s.facts.length) assert.equal(s.facts[0]!.plannedSetId, w.exercises[0]!.sets[0]!.id);
    if (s.notes.length) assert.equal(s.notes[0]!.plannedExerciseId, w.exercises[0]!.id);
    assert.equal(s.outcome, "COMPLETED");
  }
  assert.deepEqual(readTrainingWorkbook(readWorkbook(writeTrainingWorkbook(output))).sessions, output.sessions);
});

test("I05 large books use compact stable IDs and overlapping exports cannot collide", () => {
  const base = trainingTransferFixture(); const p = base.programs[0]!;
  const programs = Array.from({ length: 20 }, (_, n) => ({ ...p, id: `${n}:${"source".repeat(80)}`, title: `Programme ${n}` }));
  const value = { ...base, sessions: [], programs };
  const candidates = [{ id: "target", name: base.exercises[0]!.name, available: true }];
  const all = compileWholeWorkbook(prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value }, false), candidates)).value;
  assert.equal(all.programs[0]!.mesocycles.length, 20);
  assert.ok(all.programs[0]!.id.length < 100);
  assert.equal(readTrainingWorkbook(readWorkbook(writeTrainingWorkbook(all))).programs[0]!.mesocycles.length, 20);
  const subset = compileWholeWorkbook(prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value: { ...value, programs: [programs[0]!] } }, false), candidates)).value;
  assert.equal(all.programs[0]!.mesocycles[0]!.weeks[0]!.workouts[0]!.id, subset.programs[0]!.mesocycles[0]!.weeks[0]!.workouts[0]!.id);
  assert.notEqual(all.client.id, subset.client.id, "programme namespace isolates persisted rows while the sheet keeps its source identity");
});

test("I07 unchecked errors do not block selected sheets and reselection preserves corrections and view state", () => {
  let session = prepareWholeWorkbook(startWorkbookReview(picked([matrix("Ошибка"), matrix("Готовый", "9")]), false),
    [{ id: "target", name: "Жим штанги лёжа", available: true }]);
  assert.equal(wholeWorkbookStatus(session).problems.length, 1);
  session = updateWorkbookEntry(session, { viewWeek: 1, issueInputs: { pending: "9" }, settingsOpen: true });
  const first = session.entries["0"]!;
  session = selectWorkbookImportSheets(session, ["1"]);
  assert.equal(wholeWorkbookStatus(session).problems.length, 0);
  assert.deepEqual(compileWholeWorkbook(session).value.programs[0]!.mesocycles.map((c) => c.title), ["Готовый"]);
  session = selectWorkbookSheet(session, "1"); session = selectWorkbookImportSheets(session, ["0", "1"]); session = selectWorkbookSheet(session, "0");
  assert.equal(session.entries["0"], first);
  session = correctWorkbookValue(session, session.entries["0"]!.value!.issues![0]!.id, "9");
  session = selectWorkbookImportSheets(session, []);
  assert.equal(wholeWorkbookStatus(session).cycles, 0); assert.throws(() => compileWholeWorkbook(session));
  session = selectWorkbookImportSheets(session, ["0", "1"]);
  assert.equal(compileWholeWorkbook(session).value.programs[0]!.mesocycles.length, 2);
  assert.deepEqual(session.entries["0"]!.issueInputs, { pending: "9" });
});

test("I07 preparation yields between sheets and cancellation prevents late progress or a stale session", async () => {
  const input = startWorkbookReview(picked([matrix("Один", "8"), matrix("Два", "8"), matrix("Три", "8")]), false);
  let active = true; const progress: number[] = [];
  const result = await prepareWorkbookResponsive(input, [], () => active, (done) => { progress.push(done); active = false; });
  assert.equal(result, null); assert.deepEqual(progress, [1]);
  assert.equal(Object.keys(input.entries).length, 1, "cancelled preparation never mutates the original session");
});

test("I02 first-sheet factual range opens review with original Excel coordinates and intact plans", () => {
  const table = matrix(); const input = parse(table);
  assert.equal(input.issues!.length, 1);
  assert.equal(input.issues![0]!.raw, "8-10");
  assert.deepEqual(input.issues![0]!.source, { sheet: table.name, row: 5, column: 5 });
  assert.equal(input.issues![0]!.weekIndex, 1);
  assert.equal(input.sessions[0]!.facts[0]!.values.reps, null);
  assert.equal(input.sessions[0]!.facts[0]!.values.loadGrams, 42500);
  assert.equal(input.sessions[0]!.facts[1]!.values.reps, 12);
  const plan = input.programs[0]!.mesocycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!;
  assert.equal(plan.sets.length, 2); assert.equal(plan.sets[0]!.reps, 8); assert.equal(plan.sets[0]!.repsMax, 10);
  assert.equal(plan.sets[0]!.loadGrams, 62500);
  const original = JSON.stringify(input);
  const corrected = correctTransferIssue(input, input.issues![0]!.id, "10");
  assert.equal(corrected.issues, undefined);
  assert.equal(corrected.sessions[0]!.facts[0]!.values.reps, 10);
  assert.equal(corrected.sessions[0]!.actualDate, "2026-10-20");
  assert.equal(JSON.stringify(input), original, "review never mutates the source or other sheet snapshots");
  assert.deepEqual(corrected.programs, input.programs);
});

test("I02 clearing the only actual value is explicit null, never zero or a confirmed empty set", () => {
  const input = parse(matrix("Пустой факт", "8-10", ""));
  const corrected = correctTransferIssue(input, input.issues![0]!.id, "пусто");
  const fact = corrected.sessions[0]!.facts[0]!;
  assert.deepEqual(fact.values, { reps: null, loadGrams: null, durationSec: null, distanceM: null });
  assert.equal(fact.confirmed, false);
  assert.equal(corrected.sessions[0]!.facts[1]!.values.reps, 12);
  const restored = readTrainingWorkbook(readWorkbook(writeTrainingWorkbook(corrected)));
  assert.deepEqual(restored.sessions, corrected.sessions);
  assert.deepEqual(restored.programs[0]!.mesocycles[0]!.weeks, corrected.programs[0]!.mesocycles[0]!.weeks);
});

test("I02 several invalid metrics remain pending individually; fractional loads and explicit corrections survive", () => {
  let input = parse(matrix("Ошибки", "8-10", "свой вес"));
  assert.equal(input.issues!.length, 2);
  const reps = input.issues!.find((issue) => issue.field === "reps")!;
  const load = input.issues!.find((issue) => issue.field === "loadGrams")!;
  for (const invalid of ["", "8-10", "2,5", "-1", "1000"]) assert.throws(() => correctTransferIssue(input, reps.id, invalid));
  input = correctTransferIssue(input, reps.id, "9");
  assert.equal(input.issues!.length, 1);
  assert.equal(input.sessions[0]!.facts[0]!.confirmed, false);
  input = correctTransferIssue(input, load.id, "62,5");
  assert.equal(input.issues, undefined);
  assert.equal(input.sessions[0]!.facts[0]!.confirmed, true);
  assert.equal(input.sessions[0]!.facts[0]!.values.loadGrams, 62500);
  assert.throws(() => correctTransferIssue(input, reps.id, "10"), /уже исправлено/);
});

test("I02 tab changes retain matching, column settings and corrections and expose only the active sheet", () => {
  let session = startWorkbookReview(picked([matrix(), matrix("Второй лист", "7")]), false);
  const issue = session.entries["0"]!.value!.issues![0]!;
  const exerciseId = session.entries["0"]!.value!.exercises[0]!.id;
  session = correctWorkbookValue(session, issue.id, "10");
  session = updateWorkbookEntry(session, { mapping: { [exerciseId]: "sys:chosen-exercise" }, settingsOpen: true, settingsDirty: true });
  const first = session.entries["0"];
  session = selectWorkbookSheet(session, "1");
  assert.deepEqual(session.sheets.map((sheet) => sheet.label), ["Первый лист", "Второй лист"]);
  assert.equal(session.entries[session.activeId]!.value!.programs.length, 1);
  assert.equal(session.entries[session.activeId]!.value!.programs[0]!.title, "Второй лист");
  assert.equal(session.entries[session.activeId]!.value!.sessions[0]!.facts[0]!.values.reps, 7);
  session = selectWorkbookSheet(session, "0");
  assert.equal(session.entries["0"], first);
  session = applyWorkbookColumns(session);
  assert.equal(session.entries["0"]!.settingsDirty, false);
  assert.equal(session.entries["0"]!.value!.issues, undefined);
  assert.equal(session.entries["0"]!.value!.sessions[0]!.facts[0]!.values.reps, 10);
  assert.deepEqual(session.entries["0"]!.mapping, { [exerciseId]: "sys:chosen-exercise" });
});

test("I02 structural failure stays local to its tab and can be repaired by selecting columns", () => {
  const bad = { name: "Ручная таблица", rows: [["Движение", "Запланировано"], ["Жим", "8-10"]] };
  let session = startWorkbookReview(picked([bad, matrix("Матрица")]), true);
  assert.equal(session.entries["0"]!.value, null);
  assert.equal(session.entries["0"]!.settingsOpen, true);
  session = selectWorkbookSheet(session, "1");
  assert.ok(session.entries["1"]!.value);
  session = selectWorkbookSheet(session, "0");
  session = updateWorkbookEntry(session, { columns: { exercise: 0, reps: 1 }, settingsDirty: true });
  session = applyWorkbookColumns(session);
  assert.equal(session.entries["0"]!.error, "");
  assert.equal(session.entries["0"]!.value!.exercises[0]!.name, "Жим");
});

test("I02 changed mapping cannot replay a correction against a different source cell", () => {
  const table: ImportTable = { name: "Таблица", rows: [["Упражнение", "Факт повторений", "Другой факт", "Дата"], ["Жим", "8-10", "5-6", "2026-10-20"]] };
  let session = startWorkbookReview(picked([table]), false);
  session = correctWorkbookValue(session, session.entries["0"]!.value!.issues![0]!.id, "10");
  session = updateWorkbookEntry(session, { columns: { ...session.entries["0"]!.columns, actualReps: 2 }, settingsDirty: true });
  session = applyWorkbookColumns(session);
  assert.equal(session.entries["0"]!.value!.issues![0]!.raw, "5-6");
  assert.equal(session.entries["0"]!.value!.sessions[0]!.facts[0]!.values.reps, null);
});

test("I02 plan-only constructor ignores invalid actuals and preserves unknown dates without inventing today", () => {
  const raw = matrix();
  const unknown = { ...raw, rows: raw.rows.map((row, index) => index === 0 ? row : row.map((cell, column) => column === 10 ? "неизвестно" : cell)) };
  const plan = startWorkbookReview(picked([unknown]), true).entries["0"]!.value!;
  assert.equal(plan.issues?.length ?? 0, 0); assert.deepEqual(plan.sessions, []);
  assert.equal(plan.programs[0]!.mesocycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.sets[0]!.repsMax, 10);
  const full = startWorkbookReview(picked([unknown]), false).entries["0"]!.value!;
  assert.equal(full.sessions[0]!.actualDate, null);
  assert.equal(full.issues!.length, 1);
});

test("I02 canonical workbook tabs follow sheet order and isolate plans and history", () => {
  const fixture = trainingTransferFixture(); const p = fixture.programs[0]!; const c = p.mesocycles[0]!;
  const second = { ...c, id: "cycle-other", title: "Other", weeks: c.weeks.map((w) => ({ ...w, workouts: w.workouts.map((item) => ({ ...item, id: `other:${item.id}` })) })) };
  const value = { ...fixture, programs: [{ ...p, mesocycles: [c, second] }] };
  const scopeId = (id: string) => JSON.stringify([p.id, id]);
  let session = startWorkbookReview({ kind: "TRANSFER", value, planSheets: [{ name: "Second in Excel first", scopeId: scopeId(second.id) }, { name: "First in Excel second", scopeId: scopeId(c.id) }] }, false);
  assert.equal(session.entries["0"]!.scope!.title, "Other");
  assert.equal(session.entries["0"]!.value!.sessions.length, 0);
  session = selectWorkbookSheet(session, "1");
  assert.equal(session.entries["1"]!.value!.sessions.length, fixture.sessions.length);
  assert.equal(session.entries["1"]!.value!.programs[0]!.mesocycles.length, 1);
});

test("I02 an empty matrix is identified as empty rather than offered invented technical columns", () => {
  const table = flattenLegacyMatrix({ name: "Пустая матрица", rows: [["Упражнение", "Подход", "Неделя 1"], ["", "", "План", "Пред.", "Повт.", "Кг", "Дата"]] })!;
  assert.ok(table.matrixSource);
  const session = startWorkbookReview(picked([table]), false);
  assert.match(session.entries["0"]!.error, /нет тренировок/);
  assert.equal(session.entries["0"]!.settingsOpen, false);
});

test("I02 older matrices without date columns do not mistake the next week's plan for a date or create phantom sets", () => {
  const table = flattenLegacyMatrix({ name: "Без дат", rows: [["Упражнение", "Подход", "Неделя 1", "", "", "", "Неделя 2"],
    ["", "", "План", "Пред.", "Повт.", "Кг", "План", "Пред.", "Повт.", "Кг"], ["Тренировка А"],
    ["Жим", 1, "", "", "", "", "8-10", "", "8-10", "60"]] })!;
  const input = parse(table);
  assert.equal(input.sessions.length, 1); assert.equal(input.sessions[0]!.weekIndex, 2);
  assert.equal(input.sessions[0]!.actualDate, null);
  assert.equal(input.programs[0]!.mesocycles[0]!.weeks[0]!.workouts.length, 0);
  assert.deepEqual(input.issues![0]!.source, { sheet: table.name, row: 4, column: 9 });
});

test("IMPORT-HINT-SCROLL hints name the first sheet, week and card of every unmatched exercise once per book", () => {
  const twoWeeks = (name: string) => flattenLegacyMatrix({ name, rows: [["Упражнение", "Подход", "Неделя 1", "", "", "", "", "Неделя 2"],
    ["", "", "План", "Пред.", "Повт.", "Кг", "Дата", "План", "Пред.", "Повт.", "Кг", "Дата"], ["Тренировка А"],
    ["Жим штанги лёжа", 1, "8–10 × 62,5 кг", "", "", "", "", "", "", "", "", ""],
    ["Тяга блока", 1, "", "", "", "", "", "8–10 × 40 кг", "", "", "", ""]] })!;
  let session = prepareWholeWorkbook(startWorkbookReview(picked([twoWeeks("Первый"), twoWeeks("Второй")]), false), []);
  const hints = workbookUnmatchedTargets(session);
  assert.deepEqual(hints.map((h) => [h.sheetId, h.sheetLabel, h.weekIndex, h.name]), [["0", "Первый", 1, "Жим штанги лёжа"], ["0", "Первый", 2, "Тяга блока"]]);
  const weeks = session.entries["0"]!.value!.programs[0]!.mesocycles[0]!.weeks;
  assert.equal(weeks[1]!.workouts[0]!.exercises[0]!.id, hints[1]!.rowId);
  session = setWorkbookNameMatch(session, "Жим штанги лёжа", "target");
  assert.deepEqual(workbookUnmatchedTargets(session).map((h) => h.name), ["Тяга блока"]);
  session = selectWorkbookImportSheets(session, ["1"]);
  assert.deepEqual(workbookUnmatchedTargets(session).map((h) => [h.sheetId, h.weekIndex]), [["1", 2]]);
});
