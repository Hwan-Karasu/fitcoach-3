import assert from "node:assert/strict";
import test from "node:test";
import { addExercise, addExercises, newDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";

test("UI-OWN-029 выбор нескольких упражнений: добавляются после имеющихся в порядке выбора, у каждого свои ID", () => {
  let n = 0;
  const id = (prefix: string) => `${prefix}${n++}`;
  const start = addExercise(newDraft("w"), "w", "e-old", "sys:old", () => id("s"));
  const next = addExercises(start, "w", ["sys:c", "sys:a", "sys:b"], id);
  const exercises = next.plan.workouts[0]!.exercises;
  assert.deepEqual(exercises.map((item) => item.exerciseId), ["sys:old", "sys:c", "sys:a", "sys:b"]);
  assert.equal(new Set(exercises.map((item) => item.id)).size, 4, "плановые ID разные");
  assert.equal(new Set(exercises.flatMap((item) => item.sets.map((set) => set.id))).size,
    exercises.reduce((sum, item) => sum + item.sets.length, 0), "ID подходов разные");
  assert.equal(addExercises(start, "w", [], id), start, "пустой выбор ничего не меняет");
});
