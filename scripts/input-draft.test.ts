import assert from "node:assert/strict";
import test from "node:test";
import { reconcileInputDraft, type InputDraft } from "../apps/mobile/src/features/training/execution/domain/InputDraftRules.ts";

const clean = (saved: string): InputDraft => ({ identity: "set1:reps", saved, text: saved, invalid: false });

test("ячейка в фокусе, но без ввода: новое сохранённое значение (перенос из «Пред.») показывается", () => {
  const next = reconcileInputDraft(clean(""), "set1:reps", "8", true);
  assert.equal(next.text, "8");
  assert.equal(next.saved, "8");
});

test("введённое, но ещё не записанное значение в фокусе не затирается внешним обновлением", () => {
  const typed: InputDraft = { identity: "set1:reps", saved: "", text: "1", invalid: false };
  assert.deepEqual(reconcileInputDraft(typed, "set1:reps", "8", true), typed);
});

test("введённое значение без фокуса и без отложенной записи заменяется сохранённым", () => {
  const typed: InputDraft = { identity: "set1:reps", saved: "", text: "1", invalid: false };
  assert.equal(reconcileInputDraft(typed, "set1:reps", "8", false).text, "8");
});

test("другая ячейка (смена недели или подхода) всегда берёт своё сохранённое значение, даже при защите", () => {
  const typed: InputDraft = { identity: "w3|set1:reps", saved: "", text: "1", invalid: false };
  const next = reconcileInputDraft(typed, "w4|set1:reps", "12", true);
  assert.deepEqual(next, { identity: "w4|set1:reps", saved: "12", text: "12", invalid: false });
});

test("сохранённое не менялось — черновик остаётся как есть", () => {
  const typed: InputDraft = { identity: "set1:reps", saved: "5", text: "55", invalid: false };
  assert.equal(reconcileInputDraft(typed, "set1:reps", "5", false), typed);
});

// Сценарий владельца (п. 15): набрали значение в ячейке, запись прошла, поле осталось в фокусе; затем «Пред.» переносит другое значение —
// оно обязано показаться (раньше ячейка считала себя «набранной» и оставалась со старым текстом/пустой).
test("после записи набранного значения ячейка в фокусе принимает следующий перенос из «Пред.»", () => {
  const typed: InputDraft = { identity: "set1:loadGrams", saved: "", text: "50", invalid: false };
  const acked = reconcileInputDraft(typed, "set1:loadGrams", "50", true);
  assert.deepEqual(acked, { identity: "set1:loadGrams", saved: "50", text: "50", invalid: false }, "запись дошла — черновик догнал сохранённое");
  const transferred = reconcileInputDraft(acked, "set1:loadGrams", "110", true);
  assert.equal(transferred.text, "110", "перенос из «Пред.» показан, хотя поле в фокусе");
  // Пока запись не дошла, набранное по-прежнему не затирается (старое правило).
  assert.deepEqual(reconcileInputDraft(typed, "set1:loadGrams", "110", true), typed);
});
