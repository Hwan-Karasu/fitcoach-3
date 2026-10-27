import assert from "node:assert/strict";
import test from "node:test";
import { hasRecord, settleImportedSessions } from "../apps/mobile/src/features/import/domain/TransferCompletion.ts";
import type { TransferFact, TransferSession, TransferValues } from "../apps/mobile/src/shared/training-transfer/TrainingTransfer.ts";

const none: TransferValues = { reps: null, loadGrams: null, durationSec: null, distanceM: null };
const fact = (values: Partial<TransferValues>, more: Partial<TransferFact> = {}): TransferFact => ({ id: "f", plannedSetId: "s", plannedExerciseId: "e", exerciseId: "x", position: 0,
  setType: "NORMAL", values: { ...none, ...values }, drops: [], sides: null, rpe: null, confirmed: false, extra: false, origin: "IMPORT", revision: 1, ...more });
const session = (weekIndex: number, workoutId: string, facts: readonly TransferFact[], outcome: TransferSession["outcome"] = null, notes: TransferSession["notes"] = []): TransferSession =>
  ({ id: `session:${weekIndex}:${workoutId}`, programId: "p", weekIndex, plannedWorkoutId: workoutId, outcome, actualDate: null, startedAt: null, finishedAt: null, origin: null, facts, notes });
const plan = (...weeks: ReadonlyArray<readonly [number, readonly string[]]>) => weeks.map(([index, ids]) => ({ index, workouts: ids.map((id) => ({ id })) }));
const outcomes = (value: ReturnType<typeof settleImportedSessions>) => value.sessions.map((s) => `${s.weekIndex}:${s.plannedWorkoutId}=${s.outcome}`);

test("any value of a result counts as a record: repetitions, weight, time or distance", () => {
  assert.equal(hasRecord(session(1, "a", [fact({ reps: 8, loadGrams: 62500 })])), true);
  assert.equal(hasRecord(session(1, "a", [fact({ reps: 8 })])), true);
  assert.equal(hasRecord(session(1, "a", [fact({ loadGrams: 0 })])), true, "zero weight is still a recorded weight");
  assert.equal(hasRecord(session(1, "a", [fact({ durationSec: 60 })])), true);
  assert.equal(hasRecord(session(1, "a", [fact({ distanceM: 400 })])), true);
  assert.equal(hasRecord(session(1, "a", [fact({}), fact({ reps: 5 })])), true, "one filled set is enough");
});

test("a record can sit inside a drop or inside one side of a set", () => {
  assert.equal(hasRecord(session(1, "a", [fact({}, { setType: "DROP", drops: [{ ...none, reps: 6 }] })])), true);
  const side = (reps: number | null) => ({ values: { ...none, reps }, confirmed: false });
  assert.equal(hasRecord(session(1, "a", [fact({}, { sides: { left: side(null), right: side(7) } })])), true);
});

test("empty sets, an unconfirmed blank and a session with no sets are not records", () => {
  assert.equal(hasRecord(session(1, "a", [])), false);
  assert.equal(hasRecord(session(1, "a", [fact({}), fact({})])), false);
  assert.equal(hasRecord(session(1, "a", [fact({}, { drops: [none], setType: "DROP" })])), false);
});

test("a workout with a record is completed", () => {
  const settled = settleImportedSessions(plan([1, ["a"]]), [session(1, "a", [fact({ reps: 8, loadGrams: 60000 })])]);
  assert.deepEqual(outcomes(settled), ["1:a=COMPLETED"]);
  assert.deepEqual(settled.bare, []);
});

test("a week that is empty as a whole stays not started: no completed slots are invented", () => {
  const settled = settleImportedSessions(plan([1, ["a", "b"]], [2, ["a", "b"]]), []);
  assert.deepEqual(settled.sessions, []);
  assert.deepEqual(settled.bare, []);
});

test("an empty workout inside a week that has records is completed too", () => {
  const settled = settleImportedSessions(plan([1, ["a", "b"]]), [session(1, "a", [fact({ reps: 8 })])]);
  assert.deepEqual(outcomes(settled), ["1:a=COMPLETED"]);
  assert.deepEqual(settled.bare, [{ weekIndex: 1, workoutId: "b" }]);
});

test("weeks are judged independently: a later empty week does not become completed", () => {
  const settled = settleImportedSessions(plan([1, ["a"]], [2, ["a"]], [3, ["a"]]), [session(1, "a", [fact({ reps: 8 })]), session(2, "a", [fact({ reps: 8 })])]);
  assert.deepEqual(outcomes(settled), ["1:a=COMPLETED", "2:a=COMPLETED"]);
  assert.deepEqual(settled.bare, [], "week 3 has no records at all");
});

test("a session without values in a week that has records is completed", () => {
  const settled = settleImportedSessions(plan([1, ["a", "b"]]), [session(1, "a", [fact({ reps: 8 })]), session(1, "b", [fact({})])]);
  assert.deepEqual(outcomes(settled), ["1:a=COMPLETED", "1:b=COMPLETED"]);
});

test("a session without values in a week with no records at all keeps no outcome (and its notes)", () => {
  const notes = [{ plannedExerciseId: "e", text: "Без боли" }];
  const settled = settleImportedSessions(plan([1, ["a"]]), [session(1, "a", [fact({})], null, notes)]);
  assert.deepEqual(outcomes(settled), ["1:a=null"]);
  assert.deepEqual(settled.sessions[0]!.notes, notes);
});

test("an outcome written in the file is a fact and is never replaced", () => {
  const settled = settleImportedSessions(plan([1, ["a", "b", "c"]], [2, ["a"]]), [
    session(1, "a", [fact({ reps: 8 })], "MISSED"), session(1, "b", [], "CANCELLED"), session(1, "c", [fact({ reps: 8 })], "COMPLETED"),
    session(2, "a", [], "MISSED")]);
  assert.deepEqual(outcomes(settled), ["1:a=MISSED", "1:b=CANCELLED", "1:c=COMPLETED", "2:a=MISSED"]);
  assert.deepEqual(settled.bare, []);
});

test("the rule does not change the input", () => {
  const input = [session(1, "a", [fact({ reps: 8 })]), session(1, "b", [fact({})])]; const frozen = structuredClone(input);
  settleImportedSessions(plan([1, ["a", "b", "c"]]), input);
  assert.deepEqual(input, frozen);
});
