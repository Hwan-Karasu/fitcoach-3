import assert from "node:assert/strict";
import test from "node:test";
import { supersetRuns } from "../apps/mobile/src/features/training/plans/domain/SupersetRules.ts";

const item = (id: string, supersetId?: string) => ({ id, supersetId });
const shape = (items: readonly { id: string; supersetId?: string }[]) => supersetRuns(items).map((run) => run.map((entry) => entry.id));

test("подряд идущие упражнения одного суперсета образуют один пробег, одиночные — отдельные", () => {
  assert.deepEqual(shape([item("a"), item("b", "s1"), item("c", "s1"), item("d")]), [["a"], ["b", "c"], ["d"]]);
});

test("два суперсета подряд — два пробега", () => {
  assert.deepEqual(shape([item("a", "s1"), item("b", "s1"), item("c", "s2"), item("d", "s2")]), [["a", "b"], ["c", "d"]]);
});

test("группа, разорванная посторонним упражнением, не склеивается", () => {
  assert.deepEqual(shape([item("a", "s1"), item("x"), item("b", "s1")]), [["a"], ["x"], ["b"]]);
});

test("упражнение суперсета без пары остаётся одиночным пробегом; пустой список — пусто", () => {
  assert.deepEqual(shape([item("a", "s1")]), [["a"]]);
  assert.deepEqual(shape([]), []);
});
