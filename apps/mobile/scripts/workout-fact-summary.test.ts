import assert from "node:assert/strict";
import test from "node:test";
import type { SetFact, SetValues } from "../src/features/training/execution/domain/ExecutionModel.ts";
import { workoutFactSummary } from "../src/features/training/execution/presentation/workoutFactSummary.ts";

const values = (loadGrams: number, reps: number): SetValues => ({ loadGrams, reps, durationSec: null, distanceM: null });
const fact = (id: string, patch: Partial<SetFact> = {}): SetFact => ({ id, plannedSetId: id, plannedExerciseId: "press", exerciseId: "sys:press",
  position: 0, setType: "NORMAL", values: values(100_000, 8), drops: [], rpe: null, sides: null, confirmed: true, extra: false,
  origin: "INPUT", revision: 1, ...patch });

test("UIX-CLEAN-1: один обход фактов даёт прежний объём, учитывает дропы и только подтверждённые стороны", () => {
  let passes = 0;
  const input = { *[Symbol.iterator]() {
    passes += 1;
    yield fact("normal");
    yield fact("drop", { setType: "DROP", drops: [values(50_000, 6)] });
    yield fact("not-confirmed", { confirmed: false });
    yield fact("sided", { plannedExerciseId: "row", sides: {
      left: { values: values(20_000, 10), confirmed: true, rpe: 8 },
      right: { values: values(20_000, 9), confirmed: false, rpe: 7 },
    } });
  } };
  const summary = workoutFactSummary(input);
  assert.equal(passes, 1);
  assert.equal(summary.volumes.get("press"), 1900);
  assert.equal(summary.volumes.get("row"), 200);
});

test("UIX-CLEAN-1: разминки сгруппированы по плановому упражнению и упорядочены без изменения исходного снимка", () => {
  const later = fact("w2", { setType: "WARMUP", extra: true, position: 2 });
  const earlier = fact("w1", { setType: "WARMUP", extra: true, position: 1 });
  const input = [later, fact("other", { plannedExerciseId: "row", setType: "WARMUP", extra: true }), earlier];
  const summary = workoutFactSummary(input);
  assert.deepEqual(summary.warmups.get("press")!.map((row) => row.id), ["w1", "w2"]);
  assert.deepEqual(input.map((row) => row.id), ["w2", "other", "w1"]);
  assert.equal(workoutFactSummary([]).volumes.size, 0);
});
