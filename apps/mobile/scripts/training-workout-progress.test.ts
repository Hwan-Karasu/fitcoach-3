import assert from "node:assert/strict";
import test from "node:test";
import type { SetFact, SetValues, WorkoutExecution } from "../src/features/training/execution/domain/ExecutionModel.ts";
import { workoutProgress } from "../src/features/training/execution/presentation/workoutProgress.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";

const values = (loadKg: number | null, reps: number | null): SetValues =>
  ({ loadGrams: loadKg === null ? null : loadKg * 1000, reps, durationSec: null, distanceM: null });

const set = (id: string) => ({ id, reps: 10, repsMax: null, loadGrams: null, durationSec: null, distanceM: null });

const workout: PlannedWorkout = { id: "w", title: "Т", exercises: [
  { id: "e1", exerciseId: "sys:a", restSec: null, instruction: null, rir: null, sets: [set("s1"), set("s2"), set("s3")] },
  { id: "e2", exerciseId: "sys:b", restSec: null, instruction: null, rir: null, sets: [set("s4")] },
] };

function fact(plannedSetId: string, confirmed: boolean, v: SetValues, extra = false): SetFact {
  return { id: `f-${plannedSetId}`, plannedSetId, plannedExerciseId: plannedSetId === "s4" ? "e2" : "e1", exerciseId: "sys:a",
    position: 0, setType: "NORMAL", values: v, drops: [], rpe: null, confirmed, sides: null, extra, revision: 1 };
}

test("Сводка тренировки на экране программы: упражнения, засчитанные подходы из плановых, объём только засчитанных", () => {
  assert.deepEqual(workoutProgress(workout, undefined), { exercises: 2, sets: 4, done: 0, volumeKg: 0 }, "без выполнения — нули");
  const execution: WorkoutExecution = { session: null, notes: new Map(), facts: new Map([
    ["s1", fact("s1", true, values(100, 5))],
    ["s2", fact("s2", false, values(100, 5))],
    ["s4", fact("s4", true, values(20, 10))],
    ["x", fact("x", true, values(40, 10), true)],
  ]) };
  assert.deepEqual(workoutProgress(workout, execution), { exercises: 2, sets: 4, done: 2, volumeKg: 1100 },
    "разминка не входит в «из плановых», но её объём засчитан: 500 + 200 + 400");
});
