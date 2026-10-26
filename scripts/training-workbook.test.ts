import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readTrainingWorkbook, readWorkbook, writeTrainingWorkbook } from "../apps/mobile/src/features/import/data/TrainingWorkbook.ts";
import { parseMatrixPlan } from "../apps/mobile/src/features/import/data/MatrixWorkbook.ts";
import { trainingTransferFixture } from "./training-transfer-fixture.ts";
test("invalid source values remain visible until explicitly corrected", () => {
  const base = trainingTransferFixture(); const fact = base.sessions[0]!.facts[0]!;
  const input = { ...base, sessions: base.sessions.map((s, index) => index === 0 ? { ...s, facts: s.facts.map((f, i) => i === 0 ? { ...f, values: { ...f.values, reps: null } } : f) } : s), issues: [{ id: "issue", programId: base.sessions[0]!.programId, scope: "FACT" as const, targetId: fact.id, field: "reps" as const, raw: "10-15" }] };
  const book = readWorkbook(writeTrainingWorkbook(input));
  assert.equal(book.Sheets["Проверить значения"]!.B2.v, "10-15");
  assert.deepEqual(readTrainingWorkbook(book).issues, input.issues);
  book.Sheets["Проверить значения"]!.C2 = { t: "n", v: 12 };
  const corrected = readTrainingWorkbook(book);
  assert.equal(corrected.issues, undefined);
  assert.equal(corrected.sessions[0]!.facts[0]!.values.reps, 12);
});
test("Excel matrix round trip preserves plan ranges, fractional loads, dates and facts", () => {
  const input = trainingTransferFixture(); const book = readWorkbook(writeTrainingWorkbook(input));
  assert.equal(book.SheetNames[0], "Матрица 1");
  assert.equal(book.Workbook?.Sheets?.find((s) => s.name === "Плановые подходы")?.Hidden, 1);
  assert.equal(book.Sheets["Матрица 1"]?.C5?.v, "8–10 × 62.5 кг");
  assert.deepEqual(readTrainingWorkbook(book), input);
});
test("visible edits change plan and facts; previous is never a new fact", () => {
  const book = readWorkbook(writeTrainingWorkbook(trainingTransferFixture())); const sheet = book.Sheets["Матрица 1"]!;
  sheet.C5 = { t: "s", v: "9–12 × 63,75 кг" }; sheet.E5 = { t: "n", v: 12 }; sheet.F5 = { t: "n", v: 63.75 }; sheet.D5 = { t: "s", v: "999 × 999 кг" };
  const value = readTrainingWorkbook(book);
  assert.equal(value.programs[0]?.mesocycles[0]?.weeks[0]?.workouts[0]?.exercises[0]?.sets[0]?.loadGrams, 63750);
  assert.equal(value.sessions[0]?.facts[0]?.values.reps, 12); assert.equal(value.sessions[0]?.facts[0]?.values.loadGrams, 63750);
  assert.equal(value.sessions.length, 2);
});
test("matrix can add an explicit dated result to an empty week", () => {
  const book = readWorkbook(writeTrainingWorkbook(trainingTransferFixture())); const sheet = book.Sheets["Матрица 1"]!;
  // Week 3 begins at U: plan, previous, reps, kg, date, type, confirmation.
  sheet.W5 = { t: "n", v: 9 }; sheet.X5 = { t: "n", v: 65 }; sheet.Y5 = { t: "s", v: "2026-10-26" }; sheet.AA5 = { t: "b", v: true };
  const value = readTrainingWorkbook(book); assert.equal(value.sessions.length, 3); assert.equal(value.sessions[2]?.actualDate, "2026-10-26");
});
test("foreign versions, formulas, broken references and tampered matrix links are rejected", () => {
  const input = trainingTransferFixture();
  assert.throws(() => readTrainingWorkbook(readWorkbook(writeTrainingWorkbook({ ...input, version: 2 } as unknown as typeof input))));
  const formula = readWorkbook(writeTrainingWorkbook(input)); formula.Sheets["Матрица 1"]!.E5 = { t: "n", v: 10, f: "1+9" };
  const xlsx = createRequire(new URL("../apps/mobile/package.json", import.meta.url))("xlsx") as { write: (book: unknown, options: unknown) => ArrayBuffer };
  assert.throws(() => readWorkbook(new Uint8Array(xlsx.write(formula, { type: "array", bookType: "xlsx" }))), /формулу/u);
  const broken = { ...input, sessions: [{ ...input.sessions[0]!, programId: "missing" }] };
  assert.throws(() => readTrainingWorkbook(readWorkbook(writeTrainingWorkbook(broken))));
  const book = readWorkbook(writeTrainingWorkbook(input)); book.Sheets["__Матрица"]!.A2 = { t: "s", v: "{}" };
  assert.throws(() => readTrainingWorkbook(book), /структура матрицы/u);
});
test("historical plan versions survive Excel and their matrix is read-only", () => {
  const base = trainingTransferFixture(); const input = { ...base, planHistory: [{ id: "version", programId: "program", validFrom: "2026-09-01T00:00:00.000Z", validTo: "2026-10-01T00:00:00.000Z", simple: null, mesocycle: { ...base.programs[0]!.mesocycles[0]!, title: "Старый план" } }] };
  const book = readWorkbook(writeTrainingWorkbook(input)); assert.deepEqual(readTrainingWorkbook(book), input);
  assert.equal(book.SheetNames[1], "Матрица 2");
  book.Sheets["Матрица 2"]!.E5 = { t: "n", v: 15 };
  assert.throws(() => readTrainingWorkbook(book), /только для чтения/u);
});
test("Excel serial dates are imported as the recorded day, without timezone conversion", () => {
  const book = readWorkbook(writeTrainingWorkbook(trainingTransferFixture()));
  book.Sheets["Матрица 1"]!.G5 = { t: "n", v: 25569 };
  assert.equal(readTrainingWorkbook(book).sessions[0]?.actualDate, "1970-01-01");
});
test("matrix plan supports independent time and distance without inventing zero values", () => {
  assert.deepEqual(parseMatrixPlan("60 с × 100 м"), { reps: null, repsMax: null, loadGrams: null, durationSec: 60, distanceM: 100 });
  assert.throws(() => parseMatrixPlan("восемь"));
});
test("warmups, drop mini-sets and unilateral sides are visible and round-trip without flattening facts", () => {
  const base = trainingTransferFixture(); const first = base.sessions[0]!; const second = base.sessions[1]!;
  const drop = { ...first.facts[0]!, setType: "DROP" as const, drops: [{ reps: 6, loadGrams: 50000, durationSec: null, distanceM: null }] };
  const warmup = { ...first.facts[0]!, id: "warmup", plannedSetId: "warmup-set", setType: "WARMUP" as const, extra: true, values: { reps: 5, loadGrams: 20000, durationSec: null, distanceM: null } };
  const sided = { ...second.facts[0]!, values: { reps: null, loadGrams: null, durationSec: null, distanceM: null }, sides: { left: { values: { reps: 8, loadGrams: 20000, durationSec: null, distanceM: null }, confirmed: true }, right: { values: { reps: 9, loadGrams: 20000, durationSec: null, distanceM: null }, confirmed: true } } };
  const value = { ...base, sessions: [{ ...first, facts: [drop, warmup] }, { ...second, facts: [sided] }] };
  const book = readWorkbook(writeTrainingWorkbook(value));
  assert.equal(book.Sheets["Матрица 1"]!.B5.v, "Р"); assert.equal(book.Sheets["Матрица 1"]!.E6.v, "8 → 6");
  assert.equal(book.Sheets["Матрица 1"]!.N6.v, "Л: 8 / П: 9");
  assert.deepEqual(readTrainingWorkbook(book), value);
});
