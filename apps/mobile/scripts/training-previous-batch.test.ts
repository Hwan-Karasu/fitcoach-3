import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository } from "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { previousWeekQueries } from "../src/features/training/execution/domain/PreviousWeekQueries.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const WS = "synthetic-previous-week";
const values = (loadGrams: number) => ({ reps: 8, loadGrams, durationSec: null, distanceM: null });
const workouts = (prefix: string): readonly PlannedWorkout[] => Array.from({ length: 2 }, (_, w) => ({
  id: `${prefix}-w${w}`, title: `Workout ${w}`, exercises: Array.from({ length: 3 }, (_, e) => ({
    id: `${prefix}-w${w}-e${e}`, exerciseId: "sys:synthetic:bench", restSec: null, instruction: null, rir: null,
    sets: [0, 1].map((s) => ({ id: `${prefix}-w${w}-e${e}-s${s}`, reps: 8, repsMax: null,
      loadGrams: null, durationSec: null, distanceM: null })) })) }));

test("previous is strictly N-1 in the same workout/cycle/program/client; week 1 and missing results stay empty", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  const plans = new DevTrainingPlansRepository(shared, WS);
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await clients.initialize(); await plans.initialize(); await execution.initialize();
  try {
    const a = (await clients.create({ displayName: "Synthetic A" })).id;
    const b = (await clients.create({ displayName: "Synthetic B" })).id;
    const program = await plans.createPeriodizedProgram({ title: "Synthetic program", clientIds: [a, b],
      mesocycle: { title: "Cycle A", cycleType: null, repRange: null, startDate: null,
        weeks: Array.from({ length: 3 }, () => ({ type: "base", workouts: workouts("a") })) } });
    const revision = (await plans.getProgram(a, program.id))!.revision;
    await plans.createMesocycle(a, program.id, revision, { title: "Cycle B", weeks: 3, firstWeek: workouts("b"), clientIds: [a, b] });
    const other = await plans.createPeriodizedProgram({ title: "Other program", clientIds: [a],
      mesocycle: { title: "Other cycle", cycleType: null, repRange: null, startDate: null,
        weeks: Array.from({ length: 3 }, () => ({ type: "base", workouts: workouts("other") })) } });
    const place = async (clientId: string, programId: string, cycleIndex: number, weekIndex: number, workoutIndex = 0) => {
      const cycle = (await plans.getPeriodizedPlan(clientId, programId))!.mesocycles[cycleIndex]!;
      const workout = cycle.weeks[weekIndex - 1]!.workouts[workoutIndex]!;
      return { workout, slot: { clientId, programId, weekIndex, plannedWorkoutId: workout.id } };
    };
    const perform = async (clientId: string, programId: string, cycleIndex: number, weekIndex: number, workoutIndex: number, load: number) => {
      const { workout, slot } = await place(clientId, programId, cycleIndex, weekIndex, workoutIndex);
      const exercise = workout.exercises[0]!;
      await execution.saveSet({ slot, plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId, plannedSetId: exercise.sets[0]!.id,
        position: 0, metrics: ["load", "reps"], values: values(load), setType: "NORMAL", drops: [], rpe: null, expectedRevision: null },
      new Date(`2026-10-0${weekIndex}T10:00:00Z`));
    };
    await perform(a, program.id, 0, 1, 0, 50_000);
    await perform(a, program.id, 0, 1, 1, 60_000);
    await perform(a, program.id, 1, 1, 0, 70_000);
    await perform(b, program.id, 0, 1, 0, 80_000);
    await perform(a, other.id, 0, 1, 0, 90_000);
    const read = async (cycle: number, week: number, workoutIndex = 0) => {
      const { workout, slot } = await place(a, program.id, cycle, week, workoutIndex);
      const found = (await plans.findWorkout(a, program.id, workout.id, week))!;
      return { ...await execution.getWorkoutWithPrevious(slot, previousWeekQueries(found.workout, found.previousWorkout ?? null)), found, slot };
    };
    for (const cycle of [0, 1]) {
      const first = await read(cycle, 1);
      assert.equal(first.found.previousWorkout, null);
      assert.equal(first.previous.size, 0, "week 1 never borrows any completed workout from another cycle/program");
    }
    const second = await read(0, 2);
    const targetExercise = second.found.workout.exercises[0]!;
    assert.equal(second.previous.get(targetExercise.sets[0]!.id)!.values.loadGrams, 50_000);
    assert.equal(second.previous.size, 1, "repeated catalog exercise in another slot is not a substitute");
    assert.equal((await read(0, 2, 1)).previous.values().next().value!.values.loadGrams, 60_000);
    assert.equal((await read(1, 2)).previous.values().next().value!.values.loadGrams, 70_000);
    await perform(a, program.id, 0, 2, 1, 100_000);
    await perform(a, program.id, 1, 2, 0, 110_000);
    assert.equal((await read(0, 3)).previous.size, 0, "missing N-1 results do not fall back to N-2, another workout or cycle");
    const missing = previousWeekQueries(second.found.workout, null);
    assert.equal((await execution.getPrevious(second.slot, missing)).size, 0);
    // Extra warmups use the same bounded source workout and keep type/position matching.
    const source = (await place(a, program.id, 0, 1)).workout;
    const sourceSlot = { ...second.slot, weekIndex: 1, plannedWorkoutId: source.id };
    const warm = await execution.addWarmupSet(sourceSlot, { plannedExerciseId: source.exercises[0]!.id, exerciseId: source.exercises[0]!.exerciseId });
    await execution.saveSet({ slot: sourceSlot, plannedExerciseId: source.exercises[0]!.id, exerciseId: source.exercises[0]!.exerciseId,
      plannedSetId: warm.fact.plannedSetId, position: warm.fact.position, metrics: ["load", "reps"], values: values(20_000),
      setType: "WARMUP", drops: [], rpe: null, expectedRevision: warm.fact.revision });
    const currentWarm = await execution.addWarmupSet(second.slot, { plannedExerciseId: targetExercise.id, exerciseId: targetExercise.exerciseId });
    assert.equal((await read(0, 2)).previous.get(currentWarm.fact.plannedSetId)!.values.loadGrams, 20_000);
    await execution.removeWarmupSet(sourceSlot, warm.fact.plannedSetId, warm.fact.revision + 1);
    assert.equal((await read(0, 2)).previous.has(currentWarm.fact.plannedSetId), false);
    const beforeRemoval = (await plans.getPeriodizedPlan(a, program.id))!;
    await plans.saveWeek(a, program.id, beforeRemoval.program.revision, { mesocycleId: beforeRemoval.mesocycles[0]!.id,
      weekIndex: 1, workouts: [beforeRemoval.mesocycles[0]!.weeks[0]!.workouts[1]!], type: "base", scope: "CURRENT", clientIds: [a] });
    assert.equal((await read(0, 2)).found.previousWorkout, null, "removed prior-week counterpart is not replaced by another workout");
    assert.equal((await read(0, 2)).previous.size, 0, "retained historical facts remain available only through history");
  } finally { await execution.close(); await plans.close(); await clients.close(); }
});

test("new, replaced and ambiguous exercise occurrences have no previous-week source", () => {
  const current = workouts("current")[0]!;
  const source: PlannedWorkout = { ...workouts("previous")[0]!, exercises: current.exercises.map((e) => ({ ...e, id: `prior-${e.id}`, lineageId: e.id })) };
  assert.equal(previousWeekQueries(current, source).filter((query) => query.source !== null).length, 3);
  const replaced = { ...source, exercises: source.exercises.map((e) => ({ ...e, exerciseId: "sys:synthetic:different" })) };
  assert.ok(previousWeekQueries(current, replaced).every((query) => query.source === null));
  assert.ok(previousWeekQueries(current, { ...source, exercises: [] }).every((query) => query.source === null));
  assert.ok(previousWeekQueries(current, { ...source, exercises: [...source.exercises, ...source.exercises] })
    .every((query) => query.source === null));
});
