import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, fillSets, newDraft } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createWeekSwapWorkflow } from "../src/workflows/swapTrainingWeeks.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Workflow импортирует public.ts фич (там экраны .tsx), поэтому тест живёт здесь.
const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";

function firstWeek(): readonly PlannedWorkout[] {
  let n = 0;
  return fillSets(addExercise(newDraft("w1"), "w1", "e1", BENCH, () => `s${n++}`), "e1", "reps", 10).plan.workouts;
}

async function setup() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  const a = await clients.create({ displayName: "SyntheticA" });
  const b = await clients.create({ displayName: "SyntheticB" });
  const program = await plans.createProgram({ kind: "PERIODIZED", title: "Сила", clientIds: [a.id, b.id] });
  const created = await plans.createMesocycle(a.id, program.id, program.revision,
    { title: "Блок", weeks: 4, firstWeek: firstWeek(), clientIds: [a.id, b.id] });
  const lease = await shared.acquire();
  const swap = createWeekSwapWorkflow((task) => lease.writer.write(task), plans.weekSwapParticipant,
    execution.weekRenumberParticipant, () => new Date("2026-10-18T10:00:00Z"));
  return { db, plans, execution, a, b, programId: program.id, mesocycleId: created.mesocycleId, swap,
    close: async () => { await shared.release(); await execution.close(); await plans.close(); await clients.close(); } };
}

test("T04 перестановка недель 1↔3 (§48.21.2 п. 1): содержимое и результаты следуют за неделей, без копий", async () => {
  const { plans, execution, a, b, programId, mesocycleId, swap, close } = await setup();
  try {
    const weeksOf = async (clientId: string) => (await plans.getPeriodizedPlan(clientId, programId))!.mesocycles[0]!.weeks;
    const before = await weeksOf(a.id);
    const otherBefore = await weeksOf(b.id);
    const week1Workout = before[0]!.workouts[0]!;
    const week3Workout = before[2]!.workouts[0]!;
    const exercise = week1Workout.exercises[0]!;
    const slot1 = { clientId: a.id, programId, weekIndex: 1, plannedWorkoutId: week1Workout.id };
    await execution.saveSet({ slot: slot1, plannedExerciseId: exercise.id, exerciseId: BENCH, plannedSetId: exercise.sets[0]!.id,
      position: 0, metrics: ["load", "reps"], values: { loadGrams: 100_000, reps: 8, durationSec: null, distanceM: null },
      setType: "NORMAL", drops: [], rpe: null, expectedRevision: null });
    const facts = await execution.getWorkout(slot1);
    const versionsBefore = (await plans.getMesocycleVersions(a.id, programId, mesocycleId)).length;
    const revision = (await plans.getProgram(a.id, programId))!.revision;

    await swap.swap({ clientId: a.id, programId, mesocycleId, first: 1, second: 3, expectedRevision: revision });

    const after = await weeksOf(a.id);
    assert.equal(after.length, 4, "число недель прежнее");
    assert.equal(after[2]!.workouts[0]!.id, week1Workout.id, "бывшая неделя 1 теперь третья");
    assert.equal(after[0]!.workouts[0]!.id, week3Workout.id, "бывшая неделя 3 теперь первая");
    const moved = await execution.getWorkout({ ...slot1, weekIndex: 3 });
    assert.equal(moved.session!.id, facts.session!.id, "то же выполнение, не копия");
    assert.deepEqual([...moved.facts.keys()], [...facts.facts.keys()]);
    assert.equal((await execution.getWorkout(slot1)).session, null, "под старым номером выполнения нет");
    const statuses = await execution.getProgramStatuses(a.id, programId);
    assert.deepEqual(statuses.map((item) => [item.weekIndex, item.plannedWorkoutId]), [[3, week1Workout.id]]);
    assert.equal((await plans.getMesocycleVersions(a.id, programId, mesocycleId)).length, versionsBefore + 1, "одна новая версия");
    assert.deepEqual(await weeksOf(b.id), otherBefore, "у второго участника недели на месте");
    await assert.rejects(swap.swap({ clientId: a.id, programId, mesocycleId, first: 2, second: 4, expectedRevision: revision }),
      (error: unknown) => error instanceof Error && error.message === "PROGRAM_REVISION_CONFLICT", "старая ревизия не применяется");
    assert.deepEqual((await weeksOf(a.id)).map((week) => week.id), after.map((week) => week.id), "отказ ничего не изменил");
  } finally {
    await close();
  }
});

test("T04 схема дневника: номер недели меняется, клиент, программа и тренировка выполнения — нет", async () => {
  const { db, execution, a, programId, plans, close } = await setup();
  try {
    const workout = (await plans.getPeriodizedPlan(a.id, programId))!.mesocycles[0]!.weeks[0]!.workouts[0]!;
    const exercise = workout.exercises[0]!;
    const slot = { clientId: a.id, programId, weekIndex: 1, plannedWorkoutId: workout.id };
    await execution.saveSet({ slot, plannedExerciseId: exercise.id, exerciseId: BENCH, plannedSetId: exercise.sets[0]!.id,
      position: 0, metrics: ["load", "reps"], values: { loadGrams: 100_000, reps: 8, durationSec: null, distanceM: null },
      setType: "NORMAL", drops: [], rpe: null, expectedRevision: null });
    assert.throws(() => db.prepare("UPDATE training_sessions SET planned_workout_id = 'other'").run(), /WRONG_CLIENT_SCOPE/);
    assert.throws(() => db.prepare("UPDATE training_sessions SET program_id = 'other'").run(), /WRONG_CLIENT_SCOPE/);
    db.prepare("UPDATE training_sessions SET week_index = 2").run();
  } finally {
    await close();
  }
});
