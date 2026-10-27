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
