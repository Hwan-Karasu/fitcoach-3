import assert from "node:assert/strict";
import test from "node:test";
import { importedFactRows, isValidFactPatch, setImportedFact } from "../apps/mobile/src/features/training/plans/domain/ImportedFacts.ts";
import type { TransferSession } from "../apps/mobile/src/shared/training-transfer/TrainingTransfer.ts";

const fact = (id: string, plannedExerciseId: string, position: number, reps: number | null, loadGrams: number | null) => ({
  id, plannedSetId: `${id}:set`, plannedExerciseId, exerciseId: "sys:squat", position, setType: "NORMAL" as const,
  values: { reps, loadGrams, durationSec: null, distanceM: null }, drops: [], sides: null, rpe: null, confirmed: true, extra: false, origin: "IMPORT" as const, revision: 1 });
const sessions: TransferSession[] = [
  { id: "s1", programId: "p", weekIndex: 1, plannedWorkoutId: "w1", outcome: null, actualDate: "2026-10-20", startedAt: null, finishedAt: null, origin: null,
    facts: [fact("f2", "row-squat", 1, 6, 70000), fact("f1", "row-squat", 0, 8, 60000), fact("f3", "row-press", 0, 10, null)], notes: [] },
];

test("BUILDER-FACTS факты импортированного цикла — по упражнению плана, в порядке подходов", () => {
  const rows = importedFactRows(sessions);
  assert.deepEqual(rows.get("row-squat"), [{ id: "f1", reps: 8, loadGrams: 60000 }, { id: "f2", reps: 6, loadGrams: 70000 }]);
  assert.deepEqual(rows.get("row-press"), [{ id: "f3", reps: 10, loadGrams: null }]);
  assert.equal(rows.get("row-other"), undefined);
});

test("BUILDER-FACTS правка меняет только значение одного факта, остальное — как было", () => {
  const next = setImportedFact(sessions, "f2", { loadGrams: 72500 });
  assert.deepEqual(next[0]!.facts.map((f) => [f.id, f.values.reps, f.values.loadGrams]), [["f2", 6, 72500], ["f1", 8, 60000], ["f3", 10, null]]);
  assert.equal(next[0]!.facts[1], sessions[0]!.facts[1]);
  assert.equal(sessions[0]!.facts[0]!.values.loadGrams, 70000);
  assert.deepEqual(setImportedFact(sessions, "f3", { reps: null })[0]!.facts[2]!.values, { reps: null, loadGrams: null, durationSec: null, distanceM: null });
});

test("BUILDER-FACTS границы значений как у импорта: повторы 1–999, вес 0–1000 кг целыми граммами", () => {
  assert.equal(isValidFactPatch({ reps: 1 }), true); assert.equal(isValidFactPatch({ reps: 999 }), true); assert.equal(isValidFactPatch({ reps: null }), true);
  assert.equal(isValidFactPatch({ reps: 0 }), false); assert.equal(isValidFactPatch({ reps: 1000 }), false); assert.equal(isValidFactPatch({ reps: 8.5 }), false);
  assert.equal(isValidFactPatch({ loadGrams: 0 }), true); assert.equal(isValidFactPatch({ loadGrams: 1_000_000 }), true);
  assert.equal(isValidFactPatch({ loadGrams: -10 }), false); assert.equal(isValidFactPatch({ loadGrams: 1_000_010 }), false);
});
