import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository } from "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { PreviousQuery, PreviousSet, WorkoutExecution, WorkoutSlot } from "../src/features/training/execution/domain/ExecutionModel.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { counterpartOf } from "../src/features/training/plans/domain/ParticipantCounterpart.ts";
import { createActiveWorkouts } from "../src/read-models/activeWorkouts.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import type { SqliteConnectionPort } from "../src/shared/db/SqlitePort.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Host SQLite timings measure data loading, not Expo, rendering or saving input.
// Keep this script runnable against the backup commit for a reproducible baseline.
const optimized = process.argv.includes("--optimized");
const WS = "synthetic-navigation";
const now = new Date("2026-10-24T12:00:00Z");
const workouts: readonly PlannedWorkout[] = Array.from({ length: 3 }, (_, w) => ({ id: `w${w}`, title: `Workout ${w}`,
  exercises: Array.from({ length: 6 }, (_, e) => ({ id: `w${w}e${e}`, exerciseId: `sys:synthetic:exercise${e}`,
    restSec: null, instruction: null, rir: null, sets: Array.from({ length: 4 }, (_, s) => ({ id: `w${w}e${e}s${s}`,
      reps: 10, repsMax: null, loadGrams: null, durationSec: null, distanceM: null })) })) }));

for (const count of [1, 3, 6]) {
  const db = new DatabaseSync(":memory:");
  const port = nodeSqlitePort(db);
  let reads = 0;
  const counted: SqliteConnectionPort = { ...port,
    all: (sql, bindings) => { reads += 1; return port.all(sql, bindings); },
    first: (sql, bindings) => { reads += 1; return port.first(sql, bindings); } };
  const shared = new SharedSqliteDatabase(async () => counted);
  const clients = new DevClientRepository(shared, WS, []);
  const plans = new DevTrainingPlansRepository(shared, WS);
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await clients.initialize(); await plans.initialize(); await execution.initialize();
  try {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) ids.push((await clients.create({ displayName: `Synthetic ${i}` })).id);
    const program = await plans.createPeriodizedProgram({ title: "Navigation", clientIds: ids,
      mesocycle: { title: "Cycle", cycleType: null, repRange: null, startDate: null,
        weeks: Array.from({ length: 8 }, () => ({ type: "base", workouts })) } });
    for (const id of ids) {
      const plan = (await plans.getPeriodizedPlan(id, program.id))!;
      for (const week of plan.mesocycles[0]!.weeks.slice(0, 3)) {
        const workout = week.workouts[0]!;
        for (const exercise of workout.exercises) {
          await execution.saveSet({ slot: { clientId: id, programId: program.id, weekIndex: week.index, plannedWorkoutId: workout.id },
            plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId, plannedSetId: exercise.sets[0]!.id,
            position: 0, metrics: ["load", "reps"], values: { loadGrams: 50_000, reps: 10, durationSec: null, distanceM: null },
            setType: "NORMAL", drops: [], rpe: null, expectedRevision: null }, new Date(`2026-10-0${week.index}T10:00:00Z`));
        }
      }
    }
    // Empty caches for first navigation, while retaining the populated database.
    const reader = new DevTrainingPlansRepository(shared, WS); await reader.initialize();
    const active = createActiveWorkouts(execution, reader, clients);
    const loadDiary = async (slot: WorkoutSlot) => {
      const foundPromise = reader.findWorkout(slot.clientId, slot.programId, slot.plannedWorkoutId, slot.weekIndex);
      const combined = (execution as unknown as { getWorkoutWithPrevious?: (slot: WorkoutSlot,
        queries: readonly PreviousQuery[], now?: Date) => Promise<{ current: WorkoutExecution; previous: ReadonlyMap<string, PreviousSet> }> }).getWorkoutWithPrevious;
      if (optimized && combined) {
        const data = execution.getWorkoutWithPrevious(slot, foundPromise.then((found) => found!.workout.exercises.map((e) => {
          const prior = found!.previousWorkout?.exercises.find((p) => p.exerciseId === e.exerciseId && (p.lineageId ?? p.id) === (e.lineageId ?? e.id));
          return { plannedExerciseId: e.id, exerciseId: e.exerciseId, plannedSetIds: e.sets.map((s) => s.id),
            source: prior ? { plannedWorkoutId: found!.previousWorkout!.id, plannedExerciseId: prior.id } : null };
        })), now);
        const [loaded] = await Promise.all([data, execution.getConfirmationMode()]);
        assert.equal(loaded.previous.size, 6, "benchmark must load actual preceding-week results");
      } else {
        const found = await foundPromise;
        await Promise.all([execution.getWorkout(slot), execution.getConfirmationMode()]);
        const previous = await execution.getPrevious(slot, found!.workout.exercises.map((e) => ({ plannedExerciseId: e.id,
          exerciseId: e.exerciseId, plannedSetIds: e.sets.map((s) => s.id) })), now);
        assert.equal(previous.size, 6, "baseline must load the same amount of previous data");
      }
    };
    for (const kind of ["week", ...(count > 1 ? ["participant"] : [])]) {
      const samples: { ms: number; reads: number }[] = [];
      // A slot is taken from a real plan, outside the measured navigation.
      const source = (await plans.getPeriodizedPlan(ids[0]!, program.id))!;
      for (let i = 0; i <= 30; i += 1) {
        const clientId = ids[kind === "participant" ? i % count : 0]!;
        const weekIndex = 2 + i % 2;
        const offset = i % count;
        reads = 0; const started = performance.now();
        let plan = source;
        if (kind === "participant") {
          const [from, target] = await Promise.all([reader.getPeriodizedPlan(ids[(offset + count - 1) % count]!, program.id),
            reader.getPeriodizedPlan(clientId, program.id)]);
          counterpartOf(from!.mesocycles, target!.mesocycles, target!.mesocycles[0]!.id,
            { mesocycleId: from!.mesocycles[0]!.id, weekIndex, workoutId: from!.mesocycles[0]!.weeks[weekIndex - 1]!.workouts[0]!.id });
          plan = target!;
        }
        const workout = plan.mesocycles[0]!.weeks[weekIndex - 1]!.workouts[0]!;
        await Promise.all([loadDiary({ clientId, programId: program.id, weekIndex, plannedWorkoutId: workout.id }),
          reader.getWorkoutWeekNavigation(clientId, program.id, workout.id),
          reader.getMesocycleGroup(clientId, program.id, optimized ? { mesocycleId: plan.mesocycles[0]!.id } : { workoutId: workout.id }),
          ...(!optimized || i === 0 ? [active.list()] : [])]);
        samples.push({ ms: performance.now() - started, reads });
      }
      const warm = samples.slice(1).sort((a, b) => a.ms - b.ms);
      console.log(JSON.stringify({ mode: optimized ? "optimized" : "baseline", participants: count, kind,
        firstMs: +samples[0]!.ms.toFixed(3), firstReads: samples[0]!.reads,
        medianMs: +warm[14]!.ms.toFixed(3), p95Ms: +warm[28]!.ms.toFixed(3), warmReads: warm[14]!.reads }));
    }
    await reader.close();
  } finally { await execution.close(); await plans.close(); await clients.close(); }
}
