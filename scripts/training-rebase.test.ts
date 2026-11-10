import assert from "node:assert/strict";
import test from "node:test";
import { rebaseBuilderWeeks, rebaseSimpleProgram } from "../apps/mobile/src/features/training/plans/domain/DraftRebase.ts";
import type { BuilderWeek } from "../apps/mobile/src/features/training/plans/domain/PeriodizedModel.ts";
import type { PlannedExercise, PlannedWorkout, SimpleProgramDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";

const exercise = (id: string, restSec: number | null = null): PlannedExercise => ({ id, exerciseId: `sys:${id}`, sets: [], rir: null, restSec, instruction: null });
const workout = (id: string, ...exercises: PlannedExercise[]): PlannedWorkout => ({ id, title: id, exercises });
const week = (...workouts: PlannedWorkout[]): BuilderWeek => ({ type: "base", workouts });
const ids = () => { let n = 0; return () => `n${n++}`; };

test("REVIEW-R6: недели, добавленные в мезоцикле после черновика, не пропадают, если тренер число недель не менял", () => {
  const w = workout("w", exercise("e"));
  const base = [week(w), week(w)];
  const draft = [week(w), week(w)];
  const current = [week(w), week(w), week(w)];
  assert.equal(rebaseBuilderWeeks(base, draft, current, ids()).length, 3);
});

test("REVIEW-R6: если тренер сам удалил неделю, хвост текущего плана не возвращается", () => {
  const w = workout("w", exercise("e"));
  const base = [week(w), week(w), week(w)];
  const draft = [week(w), week(w)];
  const current = [week(w), week(w), week(w)];
  assert.equal(rebaseBuilderWeeks(base, draft, current, ids()).length, 2);
});

test("REVIEW-R6: перенос правок на Простую программу не добавляет родство (lineageId) тренировкам и упражнениям", () => {
  const plan = (restSec: number | null): SimpleProgramDraft => ({ title: "П", plan: { weeks: 4, workouts: [workout("w", exercise("e", restSec))] } });
  const rebased = rebaseSimpleProgram(plan(null), plan(90), plan(null), ids());
  const [first] = rebased.plan.workouts;
  assert.equal(first!.exercises[0]!.restSec, 90, "правка тренера перенесена");
  assert.equal("lineageId" in first!, false);
  assert.equal("lineageId" in first!.exercises[0]!, false);
});

test("REVIEW-R6: упражнение, перенесённое в более раннюю тренировку недели, не пропадает при применении разницы", async () => {
  const { applyWeekOps, diffWeek } = await import("../apps/mobile/src/features/training/plans/domain/PeriodizedRules.ts");
  const x = exercise("x"); const y = exercise("y");
  const before = [workout("a", x), workout("b", y)];
  const after = [workout("a", x, y), workout("b")];
  const result = applyWeekOps(before, diffWeek(before, after), ids()).workouts;
  const present = result.flatMap((item) => item.exercises.map((entry) => entry.exerciseId));
  assert.deepEqual(present.sort(), ["sys:x", "sys:y"]);
  assert.equal(result[0]!.exercises.length, 2, "упражнение оказалось в первой тренировке");
});

test("REVIEW-R6: сохранённый черновик конструктора с неверным числом недель или позицией правки отвергается", async () => {
  const { storedMesocycleBuilder } = await import("../apps/mobile/src/features/training/plans/domain/StoredPlanShape.ts");
  const draft = (overrides: Record<string, unknown>) => ({ baseRevision: null, programTitle: "П", title: "Б", cycleType: "hypertrophy", repsText: "8-12",
    startDate: "2026-11-02", editing: 0, members: [], weeks: [{ type: "base", workouts: [] }], baseWeeks: null, ...overrides });
  assert.equal(storedMesocycleBuilder(draft({})), true);
  assert.equal(storedMesocycleBuilder(draft({ editing: 1 })), false, "позиция правки вне недель");
  assert.equal(storedMesocycleBuilder(draft({ editing: -1 })), false);
  assert.equal(storedMesocycleBuilder(draft({ weeks: [] })), false, "нет ни одной недели");
  assert.equal(storedMesocycleBuilder(draft({ weeks: Array.from({ length: 53 }, () => ({ type: "base", workouts: [] })) })), false);
});
