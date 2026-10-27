import assert from "node:assert/strict";
import test from "node:test";
import { MATRIX_ZOOM } from "../src/features/training/execution/presentation/matrixZoom.ts";
import { buildMatrixHtml, matrixEditTargets, matrixTexts, type MatrixHtmlColors } from "../src/features/training/execution/presentation/matrixHtml.ts";
import type { ProgramMatrix } from "../src/features/training/execution/presentation/programMatrix.ts";

const colors: MatrixHtmlColors = { canvas: "#000", surface: "#111", border: "#222", text: "#fff", textSecondary: "#aaa", textMuted: "#888",
  accentInk: "#0f0", success: "#0a0", input: "#333" };
const target = { plannedExerciseId: "pe1", exerciseId: "ex1", plannedSetId: "ps1", position: 0, fact: null };
const matrix: ProgramMatrix = {
  weeks: [{ index: 1, caption: null }, { index: 2, caption: null }],
  sections: [{ key: "w1", title: "Тренировка <A>", totals: new Map([[1, 1000]]),
    rows: [{ key: "w1/e1/ex1", exerciseId: "ex1", cells: new Map([[1, { workoutId: "wk1", volumeKg: 1000,
      sets: [{ label: "1", plan: "5×80", fact: "5 × 100", previous: null, reps: 5, loadGrams: 100000, hasReps: true, hasLoad: true, done: true, target }] }]]) }] }],
  totals: new Map([[1, 1000]]),
};

test("пределы масштаба как в 2.0: 0,5–1,5, старт 0,9", () => {
  assert.deepEqual([MATRIX_ZOOM.min, MATRIX_ZOOM.max, MATRIX_ZOOM.initial], [0.5, 1.5, 0.9]);
});

test("тексты матрицы: повторы, вес в кг и объём с неразрывной группировкой", () => {
  const texts = matrixTexts(matrix);
  assert.equal(texts["s:w1/e1/ex1:0:1:reps"], "5");
  assert.equal(texts["s:w1/e1/ex1:0:1:load"], "100");
  assert.match(texts["T:1"]!, /^1\s?000 кг$/u);
  assert.equal(texts["T:2"], "—");
});

test("страница: название тренировки экранируется, ячейка правится только в действующей версии", () => {
  const weeks = matrix.weeks.map((week) => ({ index: week.index, caption: null, tone: null, tint: "transparent", headTint: "transparent" }));
  const editable = buildMatrixHtml(matrix, () => "Присед", weeks, colors, true, { zoom: 0.72, x: 0, y: 0 });
  assert.ok(editable.includes("Тренировка &lt;A&gt;") && !editable.includes("<A>"));
  assert.ok(editable.includes('data-id="s:w1/e1/ex1:0:1:reps"'));
  assert.ok(!buildMatrixHtml(matrix, () => "Присед", weeks, colors, false, { zoom: 0.72, x: 0, y: 0 }).includes("data-id="));
});

test("цель правки находится по идентификатору ячейки", () => {
  const found = matrixEditTargets(matrix).get("s:w1/e1/ex1:0:1:load");
  assert.equal(found?.target.plannedSetId, "ps1");
  assert.equal(found?.workoutId, "wk1");
});
