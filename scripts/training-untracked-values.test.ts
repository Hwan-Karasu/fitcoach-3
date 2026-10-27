import assert from "node:assert/strict";
import test from "node:test";
import type { PlannedExercise, PlannedSet, PlannedWorkout } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";
import { dropUntrackedValues, validateDraft, type TrackingMetric } from "../apps/mobile/src/features/training/plans/domain/SimplePlanRules.ts";

const set = (id: string, values: Partial<PlannedSet> = {}): PlannedSet => ({ id, reps: null, repsMax: null, loadGrams: null, durationSec: null, distanceM: null, ...values });
const exercise = (id: string, exerciseId: string, sets: readonly PlannedSet[]): PlannedExercise =>
  ({ id, exerciseId, restSec: null, instruction: null, rir: null, sets });
const workout = (id: string, exercises: readonly PlannedExercise[]): PlannedWorkout => ({ id, title: "Тренировка", exercises });
const draft = (workouts: readonly PlannedWorkout[]) => ({ title: "Цикл", plan: { weeks: 1, workouts } });
const profiles: Readonly<Record<string, readonly TrackingMetric[]>> = { press: ["reps"], plank: ["duration"], squat: ["reps", "load"] };
const metricsOf = (id: string) => profiles[id] ?? null;

test("a planned weight on an exercise that tracks only repetitions blocks the plan today", () => {
  const imported = [workout("w", [exercise("e", "press", [set("s1", { reps: 8, loadGrams: 60000 })])])];
  assert.ok(validateDraft(draft(imported), metricsOf).some((issue) => issue.message === "Лишнее значение для этого упражнения."));
});

test("values the exercise profile does not track are cleared, tracked ones stay", () => {
  const imported = [workout("w", [
    exercise("e1", "press", [set("s1", { reps: 8, repsMax: 12, loadGrams: 60000, durationSec: 30 })]),
    exercise("e2", "plank", [set("s2", { reps: 10, repsMax: 12, durationSec: 45, distanceM: 100 })]),
    exercise("e3", "squat", [set("s3", { reps: 5, loadGrams: 100000, distanceM: 50 })]),
  ])];
  const cleaned = dropUntrackedValues(imported, metricsOf);
  const sets = cleaned.flatMap((w) => w.exercises.flatMap((e) => e.sets));
  assert.deepEqual(sets, [
    set("s1", { reps: 8, repsMax: 12 }),
    set("s2", { durationSec: 45 }),
    set("s3", { reps: 5, loadGrams: 100000 }),
  ]);
  assert.deepEqual(validateDraft(draft(cleaned), metricsOf), []);
});

test("nothing to clear: the same objects come back, so no needless re-render", () => {
  const clean = [workout("w", [exercise("e", "press", [set("s1", { reps: 8 })]), exercise("e2", "plank", [set("s2", { durationSec: 40 })])])];
  assert.equal(dropUntrackedValues(clean, metricsOf), clean);
});

test("ids, order, rest, instruction and RIR are not touched; an unknown exercise is left for the catalog check", () => {
  const rir = { min: 1, max: 2 };
  const source = [workout("w", [
    { ...exercise("e1", "press", [set("a", { loadGrams: 1000 }), set("b", { reps: 6 })]), restSec: 90, instruction: "Пауза", rir },
    exercise("e2", "gone", [set("c", { loadGrams: 1000 })]),
  ])];
  const cleaned = dropUntrackedValues(source, metricsOf);
  const first = cleaned[0]!.exercises[0]!;
  assert.deepEqual(first.sets.map((s) => s.id), ["a", "b"]);
  assert.equal(first.restSec, 90); assert.equal(first.instruction, "Пауза"); assert.deepEqual(first.rir, rir);
  assert.equal(cleaned[0]!.exercises[1]!.sets[0]!.loadGrams, 1000, "unknown exercise keeps its values");
  assert.equal(source[0]!.exercises[0]!.sets[0]!.loadGrams, 1000, "input is not mutated");
});
