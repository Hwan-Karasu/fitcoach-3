import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { trainingTransferFixture } from "./training-transfer-fixture.ts";
import { writeVisibleTrainingWorkbook } from "../apps/mobile/src/features/import/data/VisibleMatrixWorkbook.ts";
import { readWorkbook } from "../apps/mobile/src/features/import/data/TrainingWorkbook.ts";
import { visibleTrainingTransfer } from "../apps/mobile/src/shared/training-transfer/VisibleTrainingTransfer.ts";
import { trainingWorkbookFilename } from "../apps/mobile/src/shared/training-transfer/WorkbookFilename.ts";
import { flattenLegacyMatrix } from "../apps/mobile/src/features/import/domain/LegacyMatrix.ts";
import { detectLegacyMapping, normalizeLegacyTable } from "../apps/mobile/src/features/import/domain/LegacyExcel.ts";
const require = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const XLSX = require("xlsx") as typeof import("../apps/mobile/node_modules/xlsx/types/index.d.ts");

test("export filenames retain client and programme names and stay within filesystem limits", () => {
  const value = trainingTransferFixture();
  const name = trainingWorkbookFilename({ ...value, client: { ...value.client, name: "Иванов Иван Иванович" } });
  assert.equal(name, "Иванов Иван Иванович — Программа силы — Первый мезоцикл.xlsx");
  const long = trainingWorkbookFilename({ ...value, client: { ...value.client, name: "Клиент / ".repeat(60) } });
  assert.ok(Buffer.byteLength(long, "utf8") <= 255);
  assert.ok(!/[<>:"/\\|?*]/u.test(long)); assert.ok(long.endsWith(".xlsx"));
});

test("visible Excel contains only current named rows, no IDs or hidden sheets/columns/history", () => {
  const base = trainingTransferFixture(); const cycle = base.programs[0]!.mesocycles[0]!; const technical = "exercise_59bd742d-f57b-41da-94a2-a91cd1234567";
  const input = { ...base, exercises: [...base.exercises, { id: "lost", name: technical }],
    programs: base.programs.map((p) => ({ ...p, mesocycles: p.mesocycles.map((c) => ({ ...c, weeks: c.weeks.map((w) => ({ ...w, workouts: w.workouts.map((item) => ({ ...item, exercises: [...item.exercises, { ...item.exercises[0]!, id: "lost", exerciseId: "lost" }] })) })) })) })),
    sessions: base.sessions.map((s) => ({ ...s, actualDate: null, facts: [...s.facts, { ...s.facts[0]!, id: "orphan-fact", plannedExerciseId: "removed-exercise", exerciseId: "lost" }] })),
    planHistory: [{ id: "old", programId: "program", validFrom: "2026-01-01", validTo: "2026-02-01", simple: null, mesocycle: { ...cycle, title: "Удалённый план" } }] };
  const before = JSON.stringify(input); const book = readWorkbook(writeVisibleTrainingWorkbook(input));
  assert.deepEqual(book.SheetNames, [cycle.title]);
  assert.ok(book.Workbook?.Sheets?.every((s) => !s.Hidden));
  const sheet = book.Sheets[cycle.title]!; assert.ok(!sheet["!cols"]?.some((c) => c.hidden));
  assert.equal(sheet.A5?.v, "Жим штанги лёжа"); assert.equal(sheet.C5?.v, "8–10 × 62.5 кг");
  assert.equal(sheet.E5?.v, 8); assert.equal(sheet.F5?.v, 62.5); assert.equal(sheet.G5?.v, "неизвестно");
  assert.equal(sheet.A7, undefined);
  assert.ok(!JSON.stringify(book.Sheets).includes(technical));
  assert.ok(!JSON.stringify(book.Sheets).includes("Удалённый план"));
  assert.equal(JSON.stringify(input), before);
  const visible = visibleTrainingTransfer(input); assert.deepEqual(visible.exercises, base.exercises); assert.equal(visible.sessions[0]!.facts.length, 1);
});

test("plain snapshot reimports visible values and unknown dates without a hidden data source", () => {
  const value = trainingTransferFixture(); const input = { ...value, sessions: value.sessions.map((s) => ({ ...s, actualDate: null })) };
  const book = readWorkbook(writeVisibleTrainingWorkbook(input));
  const name = book.SheetNames[0]!; const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, defval: "", raw: false });
  const table = flattenLegacyMatrix({ name, rows })!; const found = detectLegacyMapping(table);
  const result = normalizeLegacyTable(table, "plain-file", found.header, found.mapping);
  assert.equal(result.exercises.length, 1); assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0]!.actualDate, null);
  assert.deepEqual(result.sessions[0]!.facts[0]!.values, value.sessions[0]!.facts[0]!.values);
  assert.equal(result.programs[0]!.mesocycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.sets.length, 2);
});

test("old matrix ID placeholders and their continuation rows never become constructor exercises", () => {
  const rows = [["Упражнение", "Подход", "Неделя 1"], ["", "", "План", "Пред.", "Повт.", "Кг", "Дата"],
    ["Тренировка А"], ["Жим", 1, "8–10", "", 8, 60, "неизвестно"],
    ["exercise_59bd742d-f57b-41da-94a2-a91cd1234567", 1, "", "", 12, 60], ["", 2, "", "", 12, 60]];
  const table = flattenLegacyMatrix({ name: "Лист", rows })!; const found = detectLegacyMapping(table);
  const result = normalizeLegacyTable(table, "old-export", found.header, found.mapping);
  assert.deepEqual(result.exercises.map((e) => e.name), ["Жим"]);
  assert.equal(result.sessions[0]!.facts.length, 1);
});
