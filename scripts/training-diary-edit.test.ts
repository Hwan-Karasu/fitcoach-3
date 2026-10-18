import assert from "node:assert/strict";
import test from "node:test";
import { applyDiaryEdit } from "../apps/mobile/src/features/training/plans/domain/DiaryEdit.ts";
import type { PlannedExercise, PlannedWorkout } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";

const set = (id: string) => ({ id, reps: 10, repsMax: null, loadGrams: null, durationSec: null, distanceM: null });
const exercise = (id: string, sets: number, supersetId?: string): PlannedExercise => ({ id, exerciseId: `sys:${id}`, restSec: 90,
  instruction: null, rir: null, sets: Array.from({ length: sets }, (_, index) => set(`${id}s${index}`)),
  ...(supersetId === undefined ? {} : { supersetId }) });
const workout: PlannedWorkout = { id: "w", title: "Т", exercises: [exercise("a", 2), exercise("b", 3), exercise("c", 1)] };

let n = 0;
const newId = (prefix: string) => `${prefix}-${n++}`;
const ids = (value: PlannedWorkout) => value.exercises.map((item) => item.id);

test("UI-OWN-037 правка из дневника: удалить, порядок, подход, добавить упражнения — только план, ID остальных прежние", () => {
  assert.deepEqual(ids(applyDiaryEdit(workout, { kind: "remove", exerciseId: "b" }, newId, () => [])), ["a", "c"]);
  assert.deepEqual(ids(applyDiaryEdit(workout, { kind: "reorder", order: ["c", "a", "b"] }, newId, () => [])), ["c", "a", "b"]);
  const added = applyDiaryEdit(workout, { kind: "addSet", exerciseId: "a" }, newId, () => []);
  assert.deepEqual(added.exercises[0]!.sets.map((item) => item.id).slice(0, 2), ["as0", "as1"], "прежние подходы на месте");
  assert.equal(added.exercises[0]!.sets.length, 3);
  assert.deepEqual(added.exercises[0]!.sets[2]!.reps, 10, "новый подход повторяет план последнего");
  const more = applyDiaryEdit(workout, { kind: "addExercises", exerciseIds: ["sys:x", "sys:y"] }, newId, () => []);
  assert.deepEqual(more.exercises.map((item) => item.exerciseId), ["sys:a", "sys:b", "sys:c", "sys:x", "sys:y"]);
});

test("UI-OWN-037 правка из дневника: замена — новое плановое упражнение на том же месте; суперсет с соседним и выход", () => {
  const replaced = applyDiaryEdit(workout, { kind: "replace", exerciseId: "b", newExerciseId: "sys:z" }, newId, () => ["reps"]);
  assert.deepEqual(replaced.exercises.map((item) => item.exerciseId), ["sys:a", "sys:z", "sys:c"]);
  assert.notEqual(replaced.exercises[1]!.id, "b", "у замены свой плановый ID");
  const joined = applyDiaryEdit(workout, { kind: "superset", exerciseIds: ["b", "c"] }, newId, () => []);
  const group = joined.exercises[1]!.supersetId;
  assert.ok(group !== undefined);
  assert.deepEqual(joined.exercises.map((item) => item.supersetId ?? null), [null, group, group]);
  const left = applyDiaryEdit(joined, { kind: "leaveSuperset", exerciseId: "c" }, newId, () => []);
  assert.deepEqual(left.exercises.map((item) => item.supersetId ?? null), [null, null, null], "из пары — сета нет");
});
