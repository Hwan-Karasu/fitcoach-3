import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { MATRIX_ZOOM } from "../src/features/training/execution/presentation/matrixZoom.ts";
import { buildMatrixHtml, kgText, matrixDataKey, matrixEditTargets, matrixFactKey, matrixPageKey, matrixTexts, readMatrixMessage, type MatrixHtmlColors } from "../src/features/training/execution/presentation/matrixHtml.ts";
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

test("REVIEW-R7: вес в ячейке без разделителей разрядов — его можно править в поле ввода", () => {
  assert.equal(kgText(1_234_500), "1234,5");
  assert.equal(kgText(62_500), "62,5");
  assert.equal(kgText(null), "");
});

const weeks = matrix.weeks.map((week) => ({ index: week.index, caption: null, tone: null, tint: "transparent", headTint: "transparent" }));

test("REVIEW-R7: страница меняется от всех цветов, подписей и контекста, но значения подхода обновляются без её пересборки", () => {
  const key = matrixPageKey(matrix, true, "a/p/current", () => "Присед", weeks, colors);
  for (const token of Object.keys(colors) as Array<keyof MatrixHtmlColors>) {
    assert.notEqual(matrixPageKey(matrix, true, "a/p/current", () => "Присед", weeks, { ...colors, [token]: "changed" }), key, token);
  }
  assert.notEqual(matrixPageKey(matrix, true, "b/p/current", () => "Присед", weeks, colors), key);
  assert.notEqual(matrixPageKey(matrix, true, "a/p/current", () => "Жим", weeks, colors), key);
  assert.notEqual(matrixPageKey(matrix, true, "a/p/current", () => "Присед", weeks.map((week) => ({ ...week, caption: "Новая неделя" })), colors), key);
  const renamed = { ...matrix, sections: matrix.sections.map((section) => ({ ...section, title: "Новая тренировка" })) };
  assert.notEqual(matrixPageKey(renamed, true, "a/p/current", () => "Присед", weeks, colors), key);
  assert.equal(matrixDataKey(renamed, true, "a/p/current"), matrixDataKey(matrix, true, "a/p/current"), "переименование не отменяет финальный ввод в ту же ячейку");
  const edited = { ...matrix, sections: matrix.sections.map((section) => ({ ...section, rows: section.rows.map((row) => ({ ...row,
    cells: new Map([...row.cells].map(([week, cell]) => [week, { ...cell, volumeKg: 900, sets: cell.sets.map((set) => ({ ...set, reps: 9, loadGrams: 90_000, done: false })) }])) })) })) };
  assert.equal(matrixPageKey(edited, true, "a/p/current", () => "Присед", weeks, colors), key);
  assert.equal(matrixTexts(edited)["s:w1/e1/ex1:0:1:load"], "90");
  assert.equal(matrixDataKey(edited, true, "a/p/current"), matrixDataKey(matrix, true, "a/p/current"));
  assert.notEqual(matrixDataKey(matrix, true, "b/p/current"), matrixDataKey(matrix, true, "a/p/current"));
});

test("REVIEW-R7: разделители в названиях не склеивают разные наборы упражнений в один ключ", () => {
  const twoRows = { ...matrix, sections: matrix.sections.map((section) => ({ ...section,
    rows: [section.rows[0]!, { ...section.rows[0]!, key: "other", exerciseId: "ex2" }] })) };
  const key = (first: string, second: string) => matrixPageKey(twoRows, true, "scope", (id) => id === "ex1" ? first : second, weeks, colors);
  assert.notEqual(key("A,B", "C"), key("A", "B,C"));
});

test("REVIEW-R7: смена адресата ячейки при прежней геометрии пересобирает страницу с новым id сообщений", () => {
  const changed = { ...matrix, sections: matrix.sections.map((section) => ({ ...section, rows: section.rows.map((row) => ({ ...row,
    cells: new Map([...row.cells].map(([week, cell]) => [week, { ...cell, sets: cell.sets.map((set) => ({ ...set,
      target: set.target === null ? null : { ...set.target, plannedSetId: "replacement-set" } })) }])) })) })) };
  assert.notEqual(matrixDataKey(changed, true, "scope"), matrixDataKey(matrix, true, "scope"));
  assert.notEqual(matrixPageKey(changed, true, "scope", () => "Присед", weeks, colors), matrixPageKey(matrix, true, "scope", () => "Присед", weeks, colors));
});

test("REVIEW-R7: один подход в разных неделях, тренировках и у разных клиентов имеет независимый ACK", () => {
  const revisions = new Map([
    [matrixFactKey("a", "p", 1, "w", "s"), 1], [matrixFactKey("a", "p", 2, "w", "s"), 2],
    [matrixFactKey("b", "p", 1, "w", "s"), 3], [matrixFactKey("a", "p", 1, "other", "s"), 4],
  ]);
  assert.equal(revisions.size, 4);
  assert.equal(revisions.get(matrixFactKey("b", "p", 1, "w", "s")), 3);
});

test("REVIEW-R7: сообщения снятой страницы и некорректная геометрия не превращаются в команды", () => {
  const edit = { pageId: 7, type: "edit", id: "cell", field: "load", text: "1234.5" };
  assert.deepEqual(readMatrixMessage(JSON.stringify(edit), 7), { type: "edit", id: "cell", field: "load", text: "1234.5" });
  assert.equal(readMatrixMessage(JSON.stringify(edit), 8), null);
  assert.equal(readMatrixMessage(JSON.stringify({ ...edit, field: "other" }), 7), null);
  assert.equal(readMatrixMessage("null", 7), null);
  assert.equal(readMatrixMessage("broken", 7), null);
  for (const [zoom, x, y] of [[0.1, 0, 0], [1, -1, 0], [1, 0, -1]]) {
    assert.equal(readMatrixMessage(JSON.stringify({ pageId: 7, type: "view", zoom, x, y }), 7), null);
  }
  assert.equal(readMatrixMessage('{"pageId":7,"type":"view","zoom":1e999,"x":0,"y":0}', 7), null);
});

test("REVIEW-R7: настоящий скрипт страницы маркирует прокрутку и ввод её id, большой вес редактируется без группировки", () => {
  const events = new Map<string, () => void>();
  const inputEvents = new Map<string, () => void>();
  const messages: string[] = [];
  let click!: (event: unknown) => void;
  const input = { value: "", className: "", inputMode: "", focus() {}, select() {}, replaceWith() {},
    addEventListener: (name: string, callback: () => void) => { inputEvents.set(name, callback); } };
  const viewport = { scrollLeft: 0, scrollTop: 0, addEventListener: (name: string, callback: () => void) => { events.set(name, callback); } };
  const page = buildMatrixHtml(matrix, () => "Присед", weeks, colors, true, { zoom: 1, x: 10, y: 20 }, 47);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((match) => match[1]).join("\n");
  runInNewContext(scripts, {
    window: { ReactNativeWebView: { postMessage: (json: string) => { messages.push(json); } }, addEventListener() {} },
    document: { getElementById: (id: string) => id === "viewport" ? viewport : { style: {} }, querySelectorAll: () => [], createElement: () => input,
      addEventListener: (_name: string, callback: typeof click) => { click = callback; } },
    setTimeout: (callback: () => void) => { callback(); return 1; }, clearTimeout() {},
  });
  events.get("scroll")!();
  assert.deepEqual(readMatrixMessage(messages[0]!, 47), { type: "view", zoom: 1, x: 10, y: 20 });
  const button = { textContent: kgText(1_234_500), classList: { contains: () => true }, replaceWith() {},
    getAttribute: (name: string) => name === "data-id" ? "cell" : "load" };
  click({ target: button });
  assert.equal(input.value, "1234,5");
  input.value = "1235,5"; inputEvents.get("blur")!();
  assert.deepEqual(readMatrixMessage(messages[1]!, 47), { type: "edit", id: "cell", field: "load", text: "1235.5" });
  assert.equal(readMatrixMessage(messages[1]!, 48), null);
});
