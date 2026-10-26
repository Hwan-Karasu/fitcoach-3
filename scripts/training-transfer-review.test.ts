import assert from "node:assert/strict";
import { test } from "node:test";
import { transferReviewScopes } from "../apps/mobile/src/features/import/domain/TrainingTransferReview.ts";
import { trainingTransferFixture } from "./training-transfer-fixture.ts";
import { copyWorkbookPlan, hasRepeatedWorkbookWeeks } from "../apps/mobile/src/features/import/domain/BuilderWorkbook.ts";
import { selectTransferCycle } from "../apps/mobile/src/features/import/domain/SelectTransferCycle.ts";
import { readTrainingWorkbook, readWorkbook, writeTrainingWorkbook } from "../apps/mobile/src/features/import/data/TrainingWorkbook.ts";

test("constructor review preserves the original per-week structure, groups and fact identities", () => {
  const input = trainingTransferFixture(); const before = JSON.stringify(input);
  const scopes = transferReviewScopes(input);
  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes[0]!.weeks, input.programs[0]!.mesocycles[0]!.weeks);
  assert.equal(scopes[0]!.weeks[1]!.workouts[0]!.exercises[0]!.sets[0]!.id, "s2");
  assert.equal(JSON.stringify(input), before);
});
test("simple-program review uses an independent week override without replacing the repeated base", () => {
  const input = trainingTransferFixture(); const original = input.programs[0]!;
  const first = original.mesocycles[0]!.weeks[0]!.workouts[0]!;
  const second = original.mesocycles[0]!.weeks[1]!.workouts[0]!;
  const value = { ...input, programs: [{ ...original, kind: "SIMPLE" as const, simple: { weeks: 3, workouts: [first] }, simpleWeeks: [{ index: 2, workouts: [second] }], mesocycles: [] }] };
  const [scope] = transferReviewScopes(value);
  assert.deepEqual(scope!.weeks.map((w) => w.workouts[0]!.id), ["w1", "w2", "w1"]);
  assert.equal(value.programs[0]!.simple.workouts[0]!.id, "w1");
});
test("history-only and otherwise unrepresented catalog entries stay available for matching", () => {
  const input = trainingTransferFixture(); const before = JSON.stringify(input);
  const value = { ...input, exercises: [...input.exercises, { id: "old-exercise", name: "Упражнение старого плана" }] };
  const scopes = transferReviewScopes(value);
  const history = scopes.find((s) => s.programId === null)!;
  assert.deepEqual(history.weeks[0]!.workouts[0]!.exercises.map((e) => e.exerciseId), ["old-exercise"]);
  const orphan = transferReviewScopes({ ...input, programs: input.programs.map((p) => ({ ...p, mesocycles: [] })) });
  assert.deepEqual(orphan[0]!.weeks[0]!.workouts[0]!.exercises.map((e) => e.exerciseId), ["press"]);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(transferReviewScopes({ ...input, exercises: [], programs: [], sessions: [] }), []);
});

test("worksheet-to-builder copy remaps persisted IDs and keeps weekly values and lineage without touching history", () => {
  const input = trainingTransferFixture(); const before = JSON.stringify(input); let next = 0;
  const scope = transferReviewScopes(input)[0]!;
  const copy = copyWorkbookPlan(scope, { press: "sys:press" }, () => `new:${++next}`);
  assert.equal(copy.weeks.length, 3);
  const source = scope.weeks[1]!.workouts[0]!.exercises[0]!;
  const first = copy.weeks[0]!.workouts[0]!; const second = copy.weeks[1]!.workouts[0]!;
  assert.notEqual(first.id, scope.weeks[0]!.workouts[0]!.id);
  assert.notEqual(first.id, second.id);
  assert.equal(first.lineageId, second.lineageId);
  assert.equal(second.exercises[0]!.exerciseId, "sys:press");
  assert.deepEqual({ ...second.exercises[0]!.sets[0], id: source.sets[0]!.id }, source.sets[0]);
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => copyWorkbookPlan(scope, {}, () => "unused"), /Сопоставьте/u);
  assert.throws(() => copyWorkbookPlan({ ...scope, weeks: [] }, {}, () => "unused"), /нет плана/u);
});

test("simple builder rejects differing plans instead of silently losing week variations", () => {
  const scope = transferReviewScopes(trainingTransferFixture())[0]!;
  assert.equal(hasRepeatedWorkbookWeeks(scope.weeks), true);
  assert.equal(hasRepeatedWorkbookWeeks([...scope.weeks, { workouts: scope.weeks[0]!.workouts.map((w) => ({ ...w, exercises: w.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, reps: 12 })) })) })) }]), false);
  let next = 0;
  const copy = copyWorkbookPlan({ ...scope, weeks: [scope.weeks[0]!, { ...scope.weeks[0]!, index: 2 }] }, { press: "sys:press" }, () => `copy:${++next}`);
  assert.equal(hasRepeatedWorkbookWeeks(copy.weeks), true);
  assert.equal(hasRepeatedWorkbookWeeks([{ workouts: copy.weeks[0]!.workouts }, { workouts: [] }]), false);
});

test("single-cycle export keeps historical workouts and excludes another same-named cycle on the same date", () => {
  const input = trainingTransferFixture(); const program = input.programs[0]!; const cycle = program.mesocycles[0]!;
  const other = { ...cycle, id: "other-cycle", lineageId: "other-lineage", weeks: cycle.weeks.map((w) => ({ ...w, id: `other:${w.id}`, workouts: w.workouts.map((item) => ({ ...item, id: `other:${item.id}` })) })) };
  const old = { ...cycle, weeks: cycle.weeks.map((w) => ({ ...w, workouts: w.workouts.map((item) => ({ ...item, id: `old:${item.id}` })) })) };
  const value = { ...input, programs: [{ ...program, mesocycles: [cycle, other] }], sessions: [...input.sessions, { ...input.sessions[0]!, id: "other-session", plannedWorkoutId: "other:w1" }, { ...input.sessions[0]!, id: "old-session", plannedWorkoutId: "old:w1" }],
    planHistory: [{ id: "old-plan", programId: program.id, validFrom: "2026-09-01T00:00:00.000Z", validTo: "2026-10-01T00:00:00.000Z", simple: null, mesocycle: old }] };
  const before = JSON.stringify(value);
  const selected = selectTransferCycle(value, program.id, cycle.id);
  assert.deepEqual(selected.programs[0]!.mesocycles.map((c) => c.id), [cycle.id]);
  assert.deepEqual(selected.sessions.map((s) => s.id), ["session1", "session2", "old-session"]);
  assert.deepEqual(selected.planHistory, value.planHistory);
  assert.equal(JSON.stringify(value), before);
  assert.throws(() => selectTransferCycle(value, program.id, "missing"), /больше не доступен/u);
  assert.throws(() => selectTransferCycle({ ...value, sessions: [...value.sessions, { ...input.sessions[0]!, id: "orphan", plannedWorkoutId: "unknown" }] }, program.id, cycle.id), /Экспортируйте программу целиком/u);
  // A selected current cycle remains a complete, independently readable workbook.
  const actual = selectTransferCycle(input, program.id, cycle.id);
  const restored = readTrainingWorkbook(readWorkbook(writeTrainingWorkbook(actual)));
  assert.deepEqual(restored.programs, actual.programs);
  assert.deepEqual(restored.sessions, actual.sessions);
});
